package com.example.taskflow.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.InternalAuthenticationServiceException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

class BoundedPasswordEncoderTest {

    @Test
    void encodesAndMatchesLikeTheDelegate() {
        try (BoundedPasswordEncoder encoder = new BoundedPasswordEncoder(new BCryptPasswordEncoder(4), 1, 1)) {
            String hash = encoder.encode("correct horse 1");

            assertThat(new BCryptPasswordEncoder(4).matches("correct horse 1", hash))
                    .isTrue();
            assertThat(encoder.matches("correct horse 1", hash)).isTrue();
            assertThat(encoder.matches("wrong horse 1", hash)).isFalse();
        }
    }

    /** The point of the pool: a hash never holds a request's virtual-thread carrier. */
    @Test
    void hashesOnAPlatformThreadWhenCalledFromAVirtualThread() throws Exception {
        AtomicBoolean ranOnVirtualThread = new AtomicBoolean(true);
        PasswordEncoder probe = new RecordingEncoder() {
            @Override
            public boolean matches(CharSequence raw, String encoded) {
                ranOnVirtualThread.set(Thread.currentThread().isVirtual());
                return true;
            }
        };
        try (BoundedPasswordEncoder encoder = new BoundedPasswordEncoder(probe, 1, 1);
                ExecutorService requests = Executors.newVirtualThreadPerTaskExecutor()) {
            assertThat(requests.submit(() -> encoder.matches("x", "y")).get(5, TimeUnit.SECONDS))
                    .isTrue();
        }
        assertThat(ranOnVirtualThread).isFalse();
    }

    /**
     * Ten concurrent logins against 2 threads and a queue of 3: at most 2 hash at once, 5 are
     * served, and the other 5 are refused at once with the "temporarily busy" exception.
     */
    @Test
    void runsAtMostItsThreadsAtOnceAndRefusesBeyondTheQueue() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger running = new AtomicInteger();
        AtomicInteger mostAtOnce = new AtomicInteger();
        PasswordEncoder slow = new RecordingEncoder() {
            @Override
            public boolean matches(CharSequence raw, String encoded) {
                mostAtOnce.accumulateAndGet(running.incrementAndGet(), Math::max);
                try {
                    release.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    running.decrementAndGet();
                }
                return true;
            }
        };
        try (BoundedPasswordEncoder encoder = new BoundedPasswordEncoder(slow, 2, 3);
                ExecutorService requests = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Boolean>> logins = new ArrayList<>();
            for (int i = 0; i < 10; i++) {
                logins.add(requests.submit(() -> encoder.matches("x", "y")));
            }
            // The five beyond 2 running + 3 queued fail without waiting for the others.
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (logins.stream().filter(Future::isDone).count() < 5 && System.nanoTime() < deadline) {
                Thread.sleep(10);
            }
            Thread.sleep(200); // nothing else may finish while the delegate is held
            assertThat(logins.stream()
                            .filter(login -> login.state() == Future.State.FAILED)
                            .count())
                    .isEqualTo(5);
            assertThat(logins.stream().filter(login -> !login.isDone()).count()).isEqualTo(5);
            release.countDown();

            int served = 0;
            for (Future<Boolean> login : logins) {
                try {
                    if (login.get(5, TimeUnit.SECONDS)) {
                        served++;
                    }
                } catch (java.util.concurrent.ExecutionException e) {
                    assertThat(e.getCause()).isInstanceOf(BoundedPasswordEncoder.PasswordHashingBusyException.class);
                }
            }
            assertThat(served).isEqualTo(5);
        }
        assertThat(mostAtOnce.get()).isEqualTo(2);
    }

    /** It takes the existing 503 + Retry-After path, and the login controller does not count it. */
    @Test
    void refusalIsTheTemporarilyBusyAuthenticationFailure() {
        assertThat(new BoundedPasswordEncoder.PasswordHashingBusyException())
                .isInstanceOf(InternalAuthenticationServiceException.class);
    }

    @Test
    void aFailureInsideTheDelegateReachesTheCaller() {
        PasswordEncoder broken = new RecordingEncoder() {
            @Override
            public String encode(CharSequence raw) {
                throw new IllegalArgumentException("password too long");
            }
        };
        try (BoundedPasswordEncoder encoder = new BoundedPasswordEncoder(broken, 1, 1)) {
            assertThrows(IllegalArgumentException.class, () -> encoder.encode("x"));
        }
    }

    private abstract static class RecordingEncoder implements PasswordEncoder {
        @Override
        public String encode(CharSequence raw) {
            return "encoded";
        }

        @Override
        public boolean matches(CharSequence raw, String encoded) {
            return false;
        }
    }
}
