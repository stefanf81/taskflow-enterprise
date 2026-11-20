package com.example.taskflow.auth;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Denylist of revoked JWT ids ({@code jti}).
 *
 * <p>Logout adds the presented token's {@code jti} here until the token's own expiry, after which the
 * entry is dropped (an expired token is rejected anyway). The decoder consults this list on every
 * request, so a logged-out token — including a copied mobile bearer token — stops working immediately
 * rather than lingering for the rest of its lifetime.
 *
 * <p><b>Storage.</b> With {@code app.state.store=memory} (default: dev, tests) the list lives only in
 * this JVM. With {@code app.state.store=redis} (prod) every revocation is written through to Redis
 * ({@link RedisTokenRevocationStore}: {@code revoked:<jti>} with a TTL of the token's remaining
 * lifetime), so it is shared by all replicas and survives a restart of the backend. The local map
 * stays in front as a write-through and positive cache: it is checked first, and a hit found in Redis
 * is cached locally until the token's expiry.
 *
 * <p><b>"Not revoked" answers</b> are cached too, but only under the <em>revocation generation</em>
 * they were looked up under: a counter in Redis that every revocation write increments, atomically
 * with the denylist entry ({@link RedisTokenRevocationStore#GENERATION_KEY}). This replica reads it
 * in the background at most every {@link #GENERATION_READ_MILLIS}, and trusts a cached "not revoked"
 * only while the last successful read is at most {@link #GENERATION_MAX_AGE_MILLIS} old and still
 * shows the generation the answer was cached under. A revocation on another replica therefore
 * reaches this one at once through its announcement (below), and within about one second even if
 * the announcement is lost; one on this replica is in the local map at once. Without a fresh
 * generation (Redis failing, reads late) every request asks Redis, as before. This replaced one
 * {@code PTTL} round trip on every authenticated request: 11-13% of throughput with the CPU
 * saturated (BENCHMARKS.md §81, §82).
 *
 * <p><b>Redis failures</b> never reject tokens wholesale and never throw out of the decoder: lookups
 * fall back to the local map only (revocations made on this replica keep working; ones made on other
 * replicas are not seen until Redis answers again). A revocation that could not be written is kept in
 * a bounded pending map and written (and announced) on the next successful Redis call.
 *
 * <p><b>Durability.</b> Every revocation is also written to PostgreSQL ({@link PersistentTokenRevocations},
 * V39), and {@link TokenRevocationRestorer} loads the unexpired ones back ({@link #restore}) at startup
 * and every minute: into the local map and, in Redis mode, into Redis. A revocation made during a Redis
 * outage therefore survives a restart of this replica, and one Redis forgot (restart without
 * persistence) is denied again within a minute.
 *
 * <p><b>Admin event streams.</b> A revocation publishes {@link TokenRevokedEvent} locally; in Redis
 * mode it is also announced on a pub/sub channel and other replicas re-publish it locally (see
 * {@link #onRemoteRevocation}), so streams opened with the token close on every replica.
 *
 * <p>Revoking every token of an account (demoted, deleted, password changed) is not done here but
 * through the account's token version ({@link AccountTokenCheck}).
 */
@Component
class TokenRevocationList {

    /** Caps the local map; beyond it, Redis hits are no longer cached locally (they stay in Redis). */
    static final int MAX_LOCAL_ENTRIES = 100_000;
    /** Caps revocations waiting for Redis; beyond it they are only enforced on this replica. */
    static final int MAX_PENDING = 10_000;
    /** At most this many pending revocations are written per call, so no single request pays for a backlog. */
    static final int MAX_FLUSH_PER_CALL = 100;
    /** Local cache lifetime for a Redis entry without TTL (never written by this code). */
    private static final long NO_TTL_CACHE_MILLIS = 60_000;
    /** How often the revocation generation is read, at most (on demand, never on a request's path). */
    static final long GENERATION_READ_MILLIS = 500;
    /** A cached "not revoked" is trusted only while the last generation read is at most this old. */
    static final long GENERATION_MAX_AGE_MILLIS = 1_000;
    /** A cached "not revoked" is looked up again after this long, whatever the generation. */
    static final long NOT_REVOKED_TTL_MILLIS = 30_000;
    /** Caps the "not revoked" cache; beyond it, answers are simply not cached. */
    static final int MAX_NOT_REVOKED_ENTRIES = 100_000;
    private static final long NO_GENERATION = Long.MIN_VALUE;

    /** A cached "not revoked": valid for {@code generation} until {@code untilMillis}. */
    private record NotRevoked(long generation, long untilMillis) {
    }

    private final ConcurrentHashMap<String, NotRevoked> notRevoked = new ConcurrentHashMap<>();
    /** The last generation read successfully, and when that read started; NO_GENERATION if none. */
    private volatile long generation = NO_GENERATION;
    private volatile long generationReadAt;
    /** When the last read was started, successful or not: at most one per GENERATION_READ_MILLIS. */
    private volatile long generationAttemptAt;
    private final AtomicBoolean readingGeneration = new AtomicBoolean();
    /**
     * Runs the generation reads off the request path. The Spring constructor uses a virtual thread;
     * the others never read it (no "not revoked" cache), unless a test sets one.
     */
    private volatile Executor generationReader = task -> {
    };

    private final ConcurrentHashMap<String, Instant> revoked = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Instant> pendingSync = new ConcurrentHashMap<>();
    private final ApplicationEventPublisher events;
    private final RedisTokenRevocationStore shared;
    /** Durable copy of every revocation, or {@code null} (unit tests). */
    private final PersistentTokenRevocations persistent;
    /** Token expiries are judged by {@link TokenProvider#TOKEN_CLOCK}, like the decoder judges them. */
    private final Clock clock;

    @Autowired
    public TokenRevocationList(ApplicationEventPublisher events,
                               ObjectProvider<RedisTokenRevocationStore> shared,
                               ObjectProvider<PersistentTokenRevocations> persistent) {
        this(events, shared.getIfAvailable(), persistent.getIfAvailable(), TokenProvider.TOKEN_CLOCK);
        this.generationReader = task -> Thread.ofVirtual().name("revocation-generation").start(task);
    }

    TokenRevocationList(ApplicationEventPublisher events, RedisTokenRevocationStore shared) {
        this(events, shared, TokenProvider.TOKEN_CLOCK);
    }

    TokenRevocationList(ApplicationEventPublisher events, RedisTokenRevocationStore shared, Clock clock) {
        this(events, shared, null, clock);
    }

    TokenRevocationList(ApplicationEventPublisher events, RedisTokenRevocationStore shared,
                        PersistentTokenRevocations persistent, Clock clock) {
        this.events = events;
        this.shared = shared;
        this.persistent = persistent;
        this.clock = clock;
    }

    TokenRevocationList(ApplicationEventPublisher events) {
        this(events, (RedisTokenRevocationStore) null);
    }

    TokenRevocationList() {
        this(null, (RedisTokenRevocationStore) null);
    }

    public void revoke(String jti, Instant expiresAt) {
        if (jti == null || jti.isBlank()) {
            return;
        }
        Instant now = Instant.now(clock);
        if (expiresAt == null || !expiresAt.isAfter(now)) {
            return; // already expired: nothing to deny
        }
        revoked.values().removeIf(expiry -> !expiry.isAfter(now));
        revoked.put(jti, expiresAt);
        notRevoked.remove(jti);
        if (persistent != null) {
            persistent.save(jti, expiresAt);
        }
        if (shared != null) {
            flushPending(now);
            if (shared.write(jti, expiresAt, now)) {
                shared.announce(jti, expiresAt);
            } else {
                keepPending(jti, expiresAt, now);
            }
        }
        // Long-lived streams opened with this token must not outlive the logout.
        publishLocally(jti);
    }

    /**
     * Never throws: a Redis problem degrades to the local map rather than failing (or rejecting)
     * every authenticated request.
     */
    public boolean isRevoked(String jti) {
        if (jti == null) {
            return false;
        }
        Instant now = Instant.now(clock);
        Instant expiry = revoked.get(jti);
        if (expiry != null) {
            if (expiry.isAfter(now)) {
                return true;
            }
            revoked.remove(jti, expiry);
        }
        if (shared == null) {
            return false;
        }
        long nowMillis = now.toEpochMilli();
        readGenerationIfDue(nowMillis);
        // Taken before the lookup: a revocation between the two changes the generation later and so
        // invalidates the answer cached below.
        long knownGeneration = trustedGeneration(nowMillis);
        if (knownGeneration != NO_GENERATION) {
            NotRevoked cached = notRevoked.get(jti);
            if (cached != null && cached.generation() == knownGeneration && cached.untilMillis() > nowMillis) {
                return false;
            }
        }
        try {
            flushPending(now);
            long remaining = shared.remainingMillis(jti);
            if (remaining > 0) {
                cacheLocally(jti, now.plusMillis(remaining), now);
                return true;
            }
            if (remaining == RedisTokenRevocationStore.REVOKED_WITHOUT_TTL) {
                cacheLocally(jti, now.plusMillis(NO_TTL_CACHE_MILLIS), now);
                return true;
            }
            if (remaining == RedisTokenRevocationStore.NOT_REVOKED && knownGeneration != NO_GENERATION) {
                cacheNotRevoked(jti, knownGeneration, nowMillis);
            }
            return false; // not revoked, or Redis unavailable: the local answer stands
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The generation a cached "not revoked" may be trusted for now, or NO_GENERATION. */
    private long trustedGeneration(long nowMillis) {
        long known = generation;
        return known != NO_GENERATION && nowMillis - generationReadAt <= GENERATION_MAX_AGE_MILLIS
                ? known
                : NO_GENERATION;
    }

    private void readGenerationIfDue(long nowMillis) {
        if (nowMillis - generationAttemptAt >= GENERATION_READ_MILLIS && readingGeneration.compareAndSet(false, true)) {
            generationAttemptAt = nowMillis;
            try {
                generationReader.execute(() -> {
                    try {
                        readGeneration();
                    } finally {
                        readingGeneration.set(false);
                    }
                });
            } catch (RuntimeException e) {
                readingGeneration.set(false);
            }
        }
    }

    /**
     * Reads the revocation generation; a change, or a failed read, drops every cached "not revoked".
     * Also writes revocations still pending from a Redis outage, which used to happen only on a
     * request's lookup.
     */
    void readGeneration() {
        if (shared == null) {
            return;
        }
        Instant now = Instant.now(clock);
        try {
            flushPending(now);
        } catch (RuntimeException e) {
            // the generation is read regardless
        }
        long readAt = now.toEpochMilli();
        long current = shared.generation();
        if (current == RedisTokenRevocationStore.GENERATION_UNAVAILABLE) {
            generation = NO_GENERATION;
            notRevoked.clear();
            return;
        }
        if (current != generation) {
            notRevoked.clear();
        }
        generation = current;
        generationReadAt = readAt;
    }

    /** Lets a test run the generation reads (for example on the calling thread). */
    void readGenerationWith(Executor reader) {
        this.generationReader = reader;
    }

    /** Number of cached "not revoked" answers (for tests). */
    int notRevokedCount() {
        return notRevoked.size();
    }

    private void cacheNotRevoked(String jti, long knownGeneration, long nowMillis) {
        if (notRevoked.size() >= MAX_NOT_REVOKED_ENTRIES) {
            notRevoked.values().removeIf(entry -> entry.untilMillis() <= nowMillis || entry.generation() != knownGeneration);
            if (notRevoked.size() >= MAX_NOT_REVOKED_ENTRIES) {
                return;
            }
        }
        notRevoked.put(jti, new NotRevoked(knownGeneration, nowMillis + NOT_REVOKED_TTL_MILLIS));
    }

    /**
     * Applies a revocation announced by another replica: cached locally and re-published as a local
     * {@link TokenRevokedEvent}. Deliberately not written to Redis or announced again (no echo loop);
     * the announcing replica already wrote it. Own and malformed messages are ignored.
     */
    void onRemoteRevocation(String message) {
        if (shared == null) {
            return;
        }
        RedisTokenRevocationStore.RemoteRevocation remote = shared.parse(message);
        if (remote == null) {
            return;
        }
        Instant now = Instant.now(clock);
        if (!remote.expiresAt().isAfter(now)) {
            return;
        }
        cacheLocally(remote.jti(), remote.expiresAt(), now);
        publishLocally(remote.jti());
    }

    /**
     * Applies revocations loaded from the durable copy: cached locally and, in Redis mode, written to
     * Redis again (an unchanged key just gets the same TTL), in pipelined batches. Not announced:
     * streams opened with these tokens were closed when they were revoked. Stops writing to Redis at
     * the first failed batch; the local map still gets every entry.
     *
     * @return the number of unexpired revocations applied
     */
    int restore(Iterable<RevokedToken> revocations) {
        Instant now = Instant.now(clock);
        boolean redisUp = shared != null && shared.isAvailable();
        List<Map.Entry<String, Instant>> toWrite = new ArrayList<>();
        int applied = 0;
        for (RevokedToken revocation : revocations) {
            if (revocation.getJti() == null || !revocation.getExpiresAt().isAfter(now)) {
                continue;
            }
            cacheLocally(revocation.getJti(), revocation.getExpiresAt(), now);
            if (redisUp) {
                toWrite.add(Map.entry(revocation.getJti(), revocation.getExpiresAt()));
            }
            applied++;
        }
        if (!toWrite.isEmpty()) {
            shared.writeAll(toWrite, now);
        }
        return applied;
    }

    /** Number of revocations not yet written to Redis (for tests and diagnostics). */
    int pendingCount() {
        return pendingSync.size();
    }

    private void publishLocally(String jti) {
        if (events != null) {
            events.publishEvent(new TokenRevokedEvent(jti));
        }
    }

    private void cacheLocally(String jti, Instant expiresAt, Instant now) {
        if (revoked.size() >= MAX_LOCAL_ENTRIES) {
            revoked.values().removeIf(expiry -> !expiry.isAfter(now));
            if (revoked.size() >= MAX_LOCAL_ENTRIES) {
                return; // still denied through Redis; only the local shortcut is skipped
            }
        }
        revoked.merge(jti, expiresAt, (a, b) -> a.isAfter(b) ? a : b);
    }

    private void keepPending(String jti, Instant expiresAt, Instant now) {
        if (pendingSync.size() >= MAX_PENDING) {
            pendingSync.values().removeIf(expiry -> !expiry.isAfter(now));
            if (pendingSync.size() >= MAX_PENDING) {
                return; // still denied on this replica through the local map
            }
        }
        pendingSync.put(jti, expiresAt);
    }

    /** Writes revocations made while Redis was down, once it answers again. Cheap when empty. */
    private void flushPending(Instant now) {
        if (pendingSync.isEmpty() || !shared.isAvailable()) {
            return;
        }
        int written = 0;
        for (Map.Entry<String, Instant> entry : pendingSync.entrySet()) {
            String jti = entry.getKey();
            Instant expiresAt = entry.getValue();
            if (!expiresAt.isAfter(now)) {
                pendingSync.remove(jti, expiresAt);
                continue;
            }
            if (written++ >= MAX_FLUSH_PER_CALL) {
                return; // the rest goes with the next calls
            }
            if (!shared.write(jti, expiresAt, now)) {
                return; // Redis failed again: keep the rest for the next attempt
            }
            pendingSync.remove(jti, expiresAt);
            shared.announce(jti, expiresAt);
        }
    }
}
