package com.example.taskflow.appointment.stream;

import com.example.taskflow.testsupport.MutableTestClock;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AppointmentEventStreamServiceTest {

    private static final Instant START = Instant.parse("2031-03-10T10:00:00Z");
    private static final AppointmentAdminEvent EVENT = new AppointmentAdminEvent(
            AppointmentAdminEvent.Type.CREATED, 42L, Instant.parse("2026-08-06T12:00:00Z"));

    /** An emitter that records what happens to it and can fail or block on send. */
    private static class TestEmitter extends SseEmitter {
        final AtomicInteger sends = new AtomicInteger();
        volatile boolean completed;
        volatile Exception failWith;
        volatile CountDownLatch blockUntil;
        final CountDownLatch firstSendAfterReady = new CountDownLatch(1);

        TestEmitter() {
            super(60_000L);
        }

        @Override
        public void send(SseEventBuilder builder) throws IOException {
            int n = sends.incrementAndGet();
            if (n > 1) {
                firstSendAfterReady.countDown();
            }
            CountDownLatch block = blockUntil;
            if (block != null) {
                try {
                    block.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            if (failWith instanceof IOException io) {
                throw io;
            }
            if (failWith instanceof RuntimeException runtime) {
                throw runtime;
            }
        }

        @Override
        public void complete() {
            completed = true;
        }
    }

    /** A service that hands out pre-built emitters so tests can inspect them. */
    private static AppointmentEventStreamService serviceWith(int max, Executor executor, MutableTestClock clock,
                                                             List<TestEmitter> emitters) {
        List<TestEmitter> queue = new ArrayList<>(emitters);
        return new AppointmentEventStreamService(max, clock, executor) {
            @Override
            SseEmitter newEmitter(long timeoutMillis) {
                return queue.isEmpty() ? new TestEmitter() : queue.remove(0);
            }
        };
    }

    @Test
    void subscribesAndTracksTheConnection() {
        AppointmentEventStreamService service = new AppointmentEventStreamService(1);

        SseEmitter emitter = service.subscribe("admin");

        assertNotNull(emitter);
        assertEquals(1, service.connectionCount("admin"));
    }

    @Test
    void atTheLimitTheOldestConnectionIsEvictedAndTheNewOneAccepted() {
        TestEmitter first = new TestEmitter();
        TestEmitter second = new TestEmitter();
        TestEmitter third = new TestEmitter();
        AppointmentEventStreamService service = serviceWith(2, Runnable::run,
                new MutableTestClock(START), List.of(first, second, third));

        service.subscribe("admin");
        service.subscribe("admin");
        // A reload opens a third stream before the server noticed the first one is dead: must NOT be a 429.
        SseEmitter accepted = service.subscribe("admin");

        assertEquals(third, accepted);
        assertEquals(2, service.connectionCount("admin"));
        assertTrue(first.completed, "the oldest connection is completed");
        assertEquals(2, first.sends.get(),
                "the evicted stream got its ready event plus the terminal 'evicted' event (so it won't reconnect)");
        assertFalse(second.completed);
        assertFalse(third.completed);

        // the survivors are the two newest ones
        service.publish(EVENT);
        assertEquals(2, first.sends.get(), "evicted stream receives nothing after eviction");
        assertEquals(2, second.sends.get());
        assertEquals(2, third.sends.get());
    }

    @Test
    void evictionIsPerAdministrator() {
        TestEmitter a1 = new TestEmitter();
        TestEmitter b1 = new TestEmitter();
        TestEmitter a2 = new TestEmitter();
        AppointmentEventStreamService service = serviceWith(1, Runnable::run,
                new MutableTestClock(START), List.of(a1, b1, a2));

        service.subscribe("alice");
        service.subscribe("bob");
        service.subscribe("alice");

        assertTrue(a1.completed);
        assertFalse(b1.completed);
        assertEquals(1, service.connectionCount("alice"));
        assertEquals(1, service.connectionCount("bob"));
    }

    @Test
    void failedReadyEventSurfacesAs503AndLeavesNoConnectionBehind() {
        TestEmitter broken = new TestEmitter();
        broken.failWith = new IOException("client went away");
        AppointmentEventStreamService service = serviceWith(2, Runnable::run,
                new MutableTestClock(START), List.of(broken));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> service.subscribe("admin"));

        assertEquals(503, ex.getStatusCode().value());
        assertEquals(0, service.connectionCount("admin"));
    }

    @Test
    void publishesAndSendsHeartbeatsWithoutLeakingConnectionState() throws Exception {
        AppointmentEventStreamService service = new AppointmentEventStreamService(2);
        service.subscribe("admin");

        service.publish(EVENT);
        service.sendHeartbeats();

        assertEquals(1, service.connectionCount("admin"));
        service.shutdown();
    }

    @Test
    void deadConnectionsAreRemovedByPublishAndHeartbeat() {
        TestEmitter dead = new TestEmitter();
        TestEmitter alive = new TestEmitter();
        AppointmentEventStreamService service = serviceWith(5, Runnable::run,
                new MutableTestClock(START), List.of(dead, alive));
        service.subscribe("admin");
        service.subscribe("admin");
        dead.failWith = new IOException("broken pipe");

        service.publish(EVENT);

        assertEquals(1, service.connectionCount("admin"));
        alive.failWith = new IllegalStateException("closed");
        service.sendHeartbeats();
        assertEquals(0, service.connectionCount("admin"));
    }

    @Test
    void concurrentSubscribeAndRemoveNeverLosesALiveConnection() throws Exception {
        // Regression: registration used computeIfAbsent + synchronized(set) while removal used
        // computeIfPresent, so removing the last (dead) emitter could discard the set a concurrent
        // subscribe had just added a live emitter to.
        int threads = 8;
        int rounds = 300;
        AppointmentEventStreamService service = new AppointmentEventStreamService(
                threads * rounds * 2, new MutableTestClock(START), Runnable::run) {
            @Override
            SseEmitter newEmitter(long timeoutMillis) {
                return new TestEmitter();
            }
        };

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger live = new AtomicInteger();
        List<java.util.concurrent.Future<?>> futures = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            futures.add(pool.submit(() -> {
                go.await();
                for (int i = 0; i < rounds; i++) {
                    // a connection that is about to die and is removed by the next publish ...
                    TestEmitter doomed = (TestEmitter) service.subscribe("admin");
                    doomed.failWith = new IOException("gone");
                    // ... racing with a connection that must survive
                    service.subscribe("admin");
                    live.incrementAndGet();
                    service.publish(EVENT);
                }
                return null;
            }));
        }
        go.countDown();
        for (var future : futures) {
            future.get(60, TimeUnit.SECONDS);
        }
        pool.shutdownNow();

        // every doomed emitter fails on the first publish after it was registered; one more publish
        // sweeps any that were registered after the last publish of their thread
        service.publish(EVENT);
        assertEquals(live.get(), service.connectionCount("admin"));
    }

    @Test
    void publishReturnsWithoutWritingOnTheCallingThread() {
        TestEmitter emitter = new TestEmitter();
        List<Runnable> queued = new ArrayList<>();
        AppointmentEventStreamService service = serviceWith(2, queued::add,
                new MutableTestClock(START), List.of(emitter));
        service.subscribe("admin");
        assertEquals(1, emitter.sends.get(), "ready event is written during subscribe");

        service.publish(EVENT);

        assertEquals(1, emitter.sends.get(), "publish() must only enqueue work");
        assertEquals(1, queued.size());
        queued.get(0).run();
        assertEquals(2, emitter.sends.get());
    }

    @Test
    void oneStuckConnectionDoesNotDelayOthersNorThePublisher() throws Exception {
        TestEmitter stuck = new TestEmitter();
        TestEmitter healthy = new TestEmitter();
        ExecutorService dispatcher = Executors.newFixedThreadPool(4);
        try {
            AppointmentEventStreamService service = serviceWith(2, dispatcher, new MutableTestClock(START),
                    List.of(stuck, healthy));
            service.subscribe("slow-admin");
            service.subscribe("fast-admin");
            CountDownLatch release = new CountDownLatch(1);
            stuck.blockUntil = release;

            long started = System.nanoTime();
            service.publish(EVENT);
            long publishMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();

            assertTrue(publishMillis < 1_000, "publish() must not wait for the stuck client, took " + publishMillis);
            assertTrue(healthy.firstSendAfterReady.await(5, TimeUnit.SECONDS),
                    "the healthy connection still receives the event while another is stuck");
            release.countDown();
        } finally {
            dispatcher.shutdownNow();
        }
    }

    @Test
    void saturatedDispatcherDropsEventsInsteadOfBlockingOrThrowing() {
        TestEmitter emitter = new TestEmitter();
        Executor saturated = task -> {
            throw new RejectedExecutionException("queue full");
        };
        AppointmentEventStreamService service = serviceWith(2, saturated, new MutableTestClock(START),
                List.of(emitter));
        service.subscribe("admin");

        service.publish(EVENT);
        service.publish(EVENT);

        assertEquals(2, service.droppedEventCount());
        assertEquals(1, emitter.sends.get(), "dropped events are not delivered");
        assertEquals(1, service.connectionCount("admin"), "a drop does not evict the connection");
    }

    @Test
    void heartbeatClosesStreamsWhoseAccessTokenHasExpired() {
        MutableTestClock clock = new MutableTestClock(START);
        TestEmitter expiring = new TestEmitter();
        TestEmitter noExpiry = new TestEmitter();
        TestEmitter longLived = new TestEmitter();
        AppointmentEventStreamService service = serviceWith(5, Runnable::run, clock,
                List.of(expiring, noExpiry, longLived));
        service.subscribe("admin", START.plusSeconds(60));
        service.subscribe("admin"); // overload without expiry
        service.subscribe("admin", START.plus(Duration.ofHours(1)));

        service.sendHeartbeats();
        assertFalse(expiring.completed, "token still valid");
        assertEquals(3, service.connectionCount("admin"));

        clock.advance(Duration.ofSeconds(61));
        service.sendHeartbeats();

        assertTrue(expiring.completed, "expired token closes the stream");
        assertFalse(noExpiry.completed);
        assertFalse(longLived.completed);
        assertEquals(2, service.connectionCount("admin"));
    }

    @Test
    void scheduledHeartbeatIsANoOpWhenSchedulersAreDisabled() {
        MutableTestClock clock = new MutableTestClock(START);
        TestEmitter expiring = new TestEmitter();
        AppointmentEventStreamService service = new AppointmentEventStreamService(2, clock, false) {
            @Override
            SseEmitter newEmitter(long timeoutMillis) {
                return expiring;
            }
        };
        service.subscribe("admin", START.minusSeconds(1)); // already expired

        service.scheduledHeartbeat();

        assertFalse(expiring.completed);
        assertEquals(1, service.connectionCount("admin"));
        service.shutdown();
    }

    @Test
    void revokingATokenClosesOnlyTheStreamsOpenedWithIt() {
        TestEmitter revokedStream = new TestEmitter();
        TestEmitter otherStream = new TestEmitter();
        AppointmentEventStreamService service = serviceWith(5, Runnable::run,
                new MutableTestClock(START), List.of(revokedStream, otherStream));

        service.subscribe("admin", START.plusSeconds(3600), "jti-logged-out");
        service.subscribe("admin", START.plusSeconds(3600), "jti-other-tab");

        service.onTokenRevoked(new com.example.taskflow.core.TokenRevokedEvent("jti-logged-out"));

        assertTrue(revokedStream.completed, "a logged-out token must not keep receiving events");
        assertFalse(otherStream.completed);
        assertEquals(1, service.connectionCount("admin"));
        service.publish(EVENT);
        assertEquals(1, revokedStream.sends.get());
        assertEquals(2, otherStream.sends.get());
    }
}
