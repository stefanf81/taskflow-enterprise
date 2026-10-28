package com.example.taskflow.auth;

import com.example.taskflow.core.TokenRevokedEvent;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

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
 * is cached locally until the token's expiry, so only not-revoked tokens cost a Redis round trip
 * (one {@code PTTL} per request; the request-scoped decoder already avoids a second one).
 *
 * <p><b>Redis failures</b> never reject tokens wholesale and never throw out of the decoder: lookups
 * fall back to the local map only (revocations made on this replica keep working; ones made on other
 * replicas are not seen until Redis answers again). A revocation that could not be written is kept in
 * a bounded pending map and written (and announced) on the next successful Redis call. If this
 * replica restarts before that, the revocation is lost — the same gap as the old in-memory list.
 *
 * <p><b>Admin event streams.</b> A revocation publishes {@link TokenRevokedEvent} locally; in Redis
 * mode it is also announced on a pub/sub channel and other replicas re-publish it locally (see
 * {@link #onRemoteRevocation}), so streams opened with the token close on every replica.
 *
 * <p>It does not react to a user being demoted or deleted.
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

    private final ConcurrentHashMap<String, Instant> revoked = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Instant> pendingSync = new ConcurrentHashMap<>();
    private final ApplicationEventPublisher events;
    private final RedisTokenRevocationStore shared;

    @Autowired
    public TokenRevocationList(ApplicationEventPublisher events,
                               ObjectProvider<RedisTokenRevocationStore> shared) {
        this(events, shared.getIfAvailable());
    }

    TokenRevocationList(ApplicationEventPublisher events, RedisTokenRevocationStore shared) {
        this.events = events;
        this.shared = shared;
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
        Instant now = Instant.now();
        if (expiresAt == null || !expiresAt.isAfter(now)) {
            return; // already expired: nothing to deny
        }
        revoked.values().removeIf(expiry -> !expiry.isAfter(now));
        revoked.put(jti, expiresAt);
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
        Instant now = Instant.now();
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
            return false; // not revoked, or Redis unavailable: the local answer stands
        } catch (RuntimeException e) {
            return false;
        }
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
        Instant now = Instant.now();
        if (!remote.expiresAt().isAfter(now)) {
            return;
        }
        cacheLocally(remote.jti(), remote.expiresAt(), now);
        publishLocally(remote.jti());
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
