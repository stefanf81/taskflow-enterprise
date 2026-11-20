package com.example.taskflow.appointment.stream;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.SimpleAsyncTaskScheduler;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The dashboard heartbeat must keep its rhythm while another scheduled job is stuck, e.g. the mail
 * relay waiting on an unreachable SMTP server (BENCHMARKS.md §75).
 */
class HeartbeatSchedulingTest {

    /**
     * The scheduler Boot creates when virtual threads are enabled: every fixed-delay task runs on one
     * shared thread, so a stuck one starves the others; fixed-rate ticks run on their own threads.
     */
    @Test
    void aStuckFixedDelayTaskStarvesOtherFixedDelayTasksButNotFixedRateOnes() throws Exception {
        SimpleAsyncTaskScheduler scheduler = new SimpleAsyncTaskScheduler();
        scheduler.setVirtualThreads(true);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger fixedDelayTicks = new AtomicInteger();
        AtomicInteger fixedRateTicks = new AtomicInteger();
        try {
            scheduler.scheduleWithFixedDelay(() -> {
                try {
                    release.await(5, TimeUnit.SECONDS); // a relay waiting on SMTP
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }, Duration.ofMillis(10));
            Thread.sleep(50);
            scheduler.scheduleWithFixedDelay(fixedDelayTicks::incrementAndGet, Duration.ofMillis(50));
            scheduler.scheduleAtFixedRate(fixedRateTicks::incrementAndGet, Duration.ofMillis(50));

            Thread.sleep(1000);

            assertThat(fixedDelayTicks.get()).isZero();
            assertThat(fixedRateTicks.get()).isGreaterThanOrEqualTo(10);
        } finally {
            release.countDown();
            scheduler.close();
        }
    }

    @Test
    void theHeartbeatIsScheduledAtAFixedRate() throws Exception {
        Scheduled scheduled = AppointmentEventStreamService.class.getDeclaredMethod("scheduledHeartbeat")
                .getAnnotation(Scheduled.class);

        assertThat(scheduled.fixedRateString()).contains("app.sse.heartbeat-interval-ms");
        assertThat(scheduled.fixedDelayString()).isEmpty();
        assertThat(scheduled.fixedDelay()).isNegative();
    }
}
