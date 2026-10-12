package com.example.taskflow.appointment;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import com.example.taskflow.core.TokenRevokedEvent;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Maintains the local SSE connections for authenticated administrator dashboards.
 *
 * <p><b>Concurrency.</b> The per-admin connection list is an immutable snapshot replaced inside
 * {@link ConcurrentHashMap#compute}, so registering a connection and removing the last one of an
 * administrator can never race (a concurrent removal used to be able to drop the set a new emitter
 * had just been added to). Readers iterate a stable snapshot.
 *
 * <p><b>Connection limit.</b> At most {@code app.sse.max-connections-per-admin} (default 2) streams
 * per administrator. A new subscription at the limit completes and evicts the OLDEST connection
 * instead of being rejected: a page reload or reconnect opens its new stream before the server
 * notices the old one is dead (that only happens at the next heartbeat), and must not be refused.
 * The evicted stream first receives a named {@code evicted} event: a plain close would make the
 * browser's {@code EventSource} reconnect on its own, and with more tabs than the limit the tabs
 * would then evict each other in an endless loop. The client stops reconnecting on that event.
 *
 * <p><b>Publishing.</b> {@link #publish} runs on the thread that committed the appointment
 * transaction, so it must not write to sockets itself. It hands one task per connection to a small
 * bounded executor; a slow or stuck client therefore occupies a dispatch thread, not the request
 * thread, and does not delay the other connections. If the executor is saturated the notification is
 * dropped and logged: events are idempotent "refresh" hints and the REST dashboard stays
 * authoritative.
 *
 * <p><b>Token expiry.</b> The stream outlives the request that authenticated it, so the controller
 * passes the access token's expiry when subscribing; every heartbeat completes connections whose token
 * has expired (the client reconnects and is re-authenticated). A role removal or account deletion is
 * <em>not</em> observable here without a database lookup per heartbeat; such a connection stays open
 * until its token expires, the 30-minute stream timeout elapses or the client reconnects. A
 * <em>revoked</em> token (logout) is observable: {@link TokenRevokedEvent} closes its streams.
 */
@Service
public class AppointmentEventStreamService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentEventStreamService.class);
    private static final long STREAM_TIMEOUT_MILLIS = Duration.ofMinutes(30).toMillis();
    private static final int DISPATCH_THREADS = 4;
    private static final int DISPATCH_QUEUE_CAPACITY = 256;

    /**
     * One open dashboard stream; {@code expiresAt} is the access token's expiry and {@code tokenId}
     * its {@code jti} ({@code null} = unknown).
     */
    private record Subscription(SseEmitter emitter, Instant expiresAt, String tokenId) {
    }

    /** Name of the event that tells a client its stream was replaced and it must not reconnect. */
    static final String EVICTED_EVENT = "evicted";

    private final int maxConnectionsPerAdmin;
    private final Clock clock;
    private final boolean schedulersEnabled;
    private final Executor dispatcher;
    private final ThreadPoolExecutor ownedDispatcher;
    private final Map<String, List<Subscription>> emittersByAdmin = new ConcurrentHashMap<>();
    private final AtomicLong droppedEvents = new AtomicLong();

    @Autowired
    public AppointmentEventStreamService(
            @Value("${app.sse.max-connections-per-admin:2}") int maxConnectionsPerAdmin,
            Clock clock,
            @Value("${app.schedulers.enabled:true}") boolean schedulersEnabled) {
        this.maxConnectionsPerAdmin = Math.max(1, maxConnectionsPerAdmin);
        this.clock = clock;
        this.schedulersEnabled = schedulersEnabled;
        this.ownedDispatcher = newDispatcher();
        this.dispatcher = ownedDispatcher;
    }

    AppointmentEventStreamService(int maxConnectionsPerAdmin) {
        this(maxConnectionsPerAdmin, Clock.systemUTC(), true);
    }

    /** Test seam: supply the executor that performs the socket writes. */
    AppointmentEventStreamService(int maxConnectionsPerAdmin, Clock clock, Executor dispatcher) {
        this.maxConnectionsPerAdmin = Math.max(1, maxConnectionsPerAdmin);
        this.clock = clock;
        this.schedulersEnabled = true;
        this.ownedDispatcher = null;
        this.dispatcher = dispatcher;
    }

    private static ThreadPoolExecutor newDispatcher() {
        AtomicInteger counter = new AtomicInteger();
        // Fixed-size pool (core == max) so queued sends never wait for a thread that is only
        // created once the queue is full; idle threads still time out. AbortPolicy: when the queue
        // is full the task is rejected (and dropped by the caller) - never run on the caller thread.
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                DISPATCH_THREADS, DISPATCH_THREADS, 30, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(DISPATCH_QUEUE_CAPACITY),
                runnable -> {
                    Thread thread = new Thread(runnable, "sse-dispatch-" + counter.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy());
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }

    @PreDestroy
    void shutdown() {
        if (ownedDispatcher != null) {
            ownedDispatcher.shutdownNow();
        }
    }

    /** Subscribe without token-expiry tracking (tests, non-JWT principals). */
    public SseEmitter subscribe(String adminName) {
        return subscribe(adminName, null, null);
    }

    public SseEmitter subscribe(String adminName, Instant tokenExpiresAt) {
        return subscribe(adminName, tokenExpiresAt, null);
    }

    /**
     * Registers a stream for {@code adminName}.
     *
     * @param tokenExpiresAt expiry of the access token that authenticated the request; the stream is
     *                       closed at the first heartbeat after this instant. {@code null} = never.
     * @param tokenId        the access token's {@code jti}; the stream is closed when it is revoked
     */
    public SseEmitter subscribe(String adminName, Instant tokenExpiresAt, String tokenId) {
        SseEmitter emitter = newEmitter(STREAM_TIMEOUT_MILLIS);
        emitter.onCompletion(() -> remove(adminName, emitter));
        emitter.onTimeout(() -> remove(adminName, emitter));
        emitter.onError(ignored -> remove(adminName, emitter));

        Subscription subscription = new Subscription(emitter, tokenExpiresAt, tokenId);
        List<Subscription> evicted = new ArrayList<>();
        emittersByAdmin.compute(adminName, (ignored, current) -> {
            evicted.clear();
            List<Subscription> next = new ArrayList<>(current == null ? List.of() : current);
            while (next.size() >= maxConnectionsPerAdmin) {
                evicted.add(next.remove(0)); // oldest first
            }
            next.add(subscription);
            return List.copyOf(next);
        });
        for (Subscription old : evicted) {
            logger.debug("Evicting oldest dashboard event stream of an administrator at the connection limit");
            evict(old.emitter());
        }

        try {
            emitter.send(SseEmitter.event().name("ready").comment("dashboard event stream connected"));
            return emitter;
        } catch (IOException ex) {
            remove(adminName, emitter);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Unable to open dashboard event stream.", ex);
        }
    }

    /** Overridable for tests; production uses a plain {@link SseEmitter}. */
    SseEmitter newEmitter(long timeoutMillis) {
        return new SseEmitter(timeoutMillis);
    }

    /**
     * Fans an event out to every open stream without blocking the caller: the socket writes happen on
     * the dispatch executor, one task per connection.
     */
    public void publish(AppointmentAdminEvent event) {
        String eventName = "appointment." + event.type().name().toLowerCase();
        emittersByAdmin.forEach((adminName, subscriptions) -> {
            for (Subscription subscription : subscriptions) {
                try {
                    dispatcher.execute(() -> send(adminName, subscription.emitter(),
                            SseEmitter.event().name(eventName).data(event)));
                } catch (RejectedExecutionException ex) {
                    long dropped = droppedEvents.incrementAndGet();
                    logger.warn("SSE dispatch queue saturated; dropped appointment event for one dashboard "
                            + "stream ({} dropped in total)", dropped);
                }
            }
        });
    }

    /** Scheduler entry point; a no-op when {@code app.schedulers.enabled=false}. */
    @Scheduled(fixedDelayString = "${app.sse.heartbeat-interval-ms:20000}")
    void scheduledHeartbeat() {
        if (schedulersEnabled) {
            sendHeartbeats();
        }
    }

    /**
     * Keeps otherwise idle proxy connections alive and closes streams whose access token has
     * expired. The writes go through the dispatch executor like events do, so one stuck connection
     * cannot hold up the heartbeat of the others; a dead connection is detected here by the failed
     * write.
     */
    void sendHeartbeats() {
        Instant now = clock.instant();
        emittersByAdmin.forEach((adminName, subscriptions) -> {
            for (Subscription subscription : subscriptions) {
                if (subscription.expiresAt() != null && !subscription.expiresAt().isAfter(now)) {
                    logger.debug("Closing dashboard event stream: access token expired");
                    remove(adminName, subscription.emitter());
                    subscription.emitter().complete();
                    continue;
                }
                try {
                    dispatcher.execute(() -> send(adminName, subscription.emitter(),
                            SseEmitter.event().comment("keepalive")));
                } catch (RejectedExecutionException ex) {
                    logger.debug("SSE dispatch queue saturated; skipped one keepalive");
                }
            }
        });
    }

    /** Closes every stream that was opened with a now-revoked access token. */
    @EventListener
    void onTokenRevoked(TokenRevokedEvent event) {
        if (event.tokenId() == null) {
            return;
        }
        emittersByAdmin.forEach((adminName, subscriptions) -> {
            for (Subscription subscription : subscriptions) {
                if (event.tokenId().equals(subscription.tokenId())) {
                    logger.debug("Closing dashboard event stream: access token revoked");
                    remove(adminName, subscription.emitter());
                    subscription.emitter().complete();
                }
            }
        });
    }

    /**
     * Tells the client it was replaced (so it does not auto-reconnect) and then closes the stream.
     * The write goes through the dispatcher like any other, so a dead socket cannot stall the
     * request that opened the replacement stream.
     */
    private void evict(SseEmitter emitter) {
        Runnable task = () -> {
            try {
                emitter.send(SseEmitter.event().name(EVICTED_EVENT).data("connection-limit"));
            } catch (IOException | IllegalStateException ignored) {
                // already gone; completing below is still correct
            } finally {
                emitter.complete();
            }
        };
        try {
            dispatcher.execute(task);
        } catch (RejectedExecutionException ex) {
            emitter.complete();
        }
    }

    int connectionCount(String adminName) {
        return emittersByAdmin.getOrDefault(adminName, List.of()).size();
    }

    long droppedEventCount() {
        return droppedEvents.get();
    }

    private void send(String adminName, SseEmitter emitter, SseEmitter.SseEventBuilder event) {
        try {
            emitter.send(event);
        } catch (IOException | IllegalStateException ex) {
            logger.debug("Removing closed dashboard event stream for {}", adminName);
            remove(adminName, emitter);
        }
    }

    private void remove(String adminName, SseEmitter emitter) {
        emittersByAdmin.computeIfPresent(adminName, (ignored, subscriptions) -> {
            List<Subscription> remaining = subscriptions.stream()
                    .filter(subscription -> subscription.emitter() != emitter)
                    .toList();
            return remaining.isEmpty() ? null : remaining;
        });
    }
}
