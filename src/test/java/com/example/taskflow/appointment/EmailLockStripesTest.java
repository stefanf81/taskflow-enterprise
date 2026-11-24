package com.example.taskflow.appointment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.TransientDataAccessException;

class EmailLockStripesTest {

    @Test
    void sameAddressInAnyCaseOrSpacingSharesAStripe() {
        EmailLockStripes stripes = new EmailLockStripes(64, Duration.ofSeconds(1));

        Lock lock = stripes.acquire(" Jane@Example.com ");
        Lock same = stripes.acquire("jane@example.com"); // re-entrant on this thread
        assertThat(same).isSameAs(lock);
        same.unlock();
        lock.unlock();
    }

    /**
     * The database is down and the booking holding the stripe waits out its connection timeout.
     * Every other booking for that address used to queue behind it, one timeout each, for as long
     * as the outage lasted (BENCHMARKS.md §80). Now each gives up after the bound with the
     * "temporarily busy" exception.
     */
    @Test
    void aBookingWaitsAtMostTheBoundForAStalledOneAndIsToldToRetry() throws Exception {
        EmailLockStripes stripes = new EmailLockStripes(64, Duration.ofMillis(200));
        CountDownLatch holding = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (ExecutorService requests = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<?> stalled = requests.submit(() -> {
                Lock lock = stripes.acquire("jane@example.com");
                try {
                    holding.countDown();
                    release.await();
                } finally {
                    lock.unlock();
                }
                return null;
            });
            holding.await();

            List<Future<Long>> waits = new ArrayList<>();
            for (int i = 0; i < 5; i++) {
                waits.add(requests.submit(() -> {
                    long start = System.nanoTime();
                    CannotAcquireLockException busy =
                            assertThrows(CannotAcquireLockException.class, () -> stripes.acquire("jane@example.com"));
                    assertThat(busy).isInstanceOf(TransientDataAccessException.class); // 503 + Retry-After
                    return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
                }));
            }
            for (Future<Long> wait : waits) {
                assertThat(wait.get(5, TimeUnit.SECONDS)).isBetween(150L, 1_000L);
            }
            release.countDown();
            stalled.get(5, TimeUnit.SECONDS);
        }

        Lock free = stripes.acquire("jane@example.com"); // released again
        free.unlock();
    }

    @Test
    void aHealthyBookingAheadIsWaitedFor() throws Exception {
        EmailLockStripes stripes = new EmailLockStripes(64, Duration.ofSeconds(2));
        Lock first = stripes.acquire("jane@example.com");
        try (ExecutorService requests = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Boolean> second = requests.submit(() -> {
                Lock lock = stripes.acquire("jane@example.com");
                lock.unlock();
                return true;
            });
            Thread.sleep(50);
            first.unlock();
            assertThat(second.get(5, TimeUnit.SECONDS)).isTrue();
        }
    }
}
