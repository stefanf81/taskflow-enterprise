package com.example.taskflow.auth;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory denylist of revoked JWT ids ({@code jti}).
 *
 * <p>Logout adds the presented token's {@code jti} here until the token's own
 * expiry, after which the entry is dropped (an expired token is rejected anyway).
 * The decoder consults this list on every request, so a logged-out token —
 * including a copied mobile bearer token — stops working immediately rather than
 * lingering for the rest of its lifetime.
 *
 * <p>Limitations, by design for the documented single-replica deployment:
 * the list lives in this JVM, so it is cleared by a restart (a revoked token
 * could then work again for at most its remaining lifetime) and is not shared
 * between replicas. Moving it to Redis with a TTL is the upgrade path before
 * scaling out. It also does not react to a user being demoted or deleted.
 */
@Component
public class TokenRevocationList {

    private final ConcurrentHashMap<String, Instant> revoked = new ConcurrentHashMap<>();

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
    }

    public boolean isRevoked(String jti) {
        if (jti == null) {
            return false;
        }
        Instant expiry = revoked.get(jti);
        return expiry != null && expiry.isAfter(Instant.now());
    }
}
