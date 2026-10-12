package com.example.taskflow.core;

import org.springframework.core.env.Environment;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Where cross-replica state lives: the JWT denylist ({@code TokenRevocationList}), the failed-login
 * counters ({@code LoginAttemptLimiter}) and the cross-replica cache-load lock
 * ({@link SingleFlightCacheManager}).
 *
 * <p>{@code app.state.store=memory} (the default: dev, tests and the offline CDS training build) keeps
 * everything in this JVM and never touches Redis. {@code app.state.store=redis} (set by
 * {@code application-prod.properties}) shares the state through Redis, with the in-memory
 * implementation as the fallback while Redis is failing. The rate limiter is configured separately
 * ({@code app.rate-limit.enabled}) and always uses Redis when enabled.
 */
public final class SharedStateStore {

    public static final String PROPERTY = "app.state.store";
    public static final String REDIS = "redis";
    public static final String MEMORY = "memory";

    /** Raw key parts longer than this are replaced by their SHA-256, so keys stay small. */
    static final int MAX_RAW_KEY_LENGTH = 128;

    private SharedStateStore() {
    }

    public static boolean isRedis(Environment environment) {
        return REDIS.equalsIgnoreCase(environment.getProperty(PROPERTY, MEMORY).trim());
    }

    /** Lower-case hex SHA-256 of {@code value} (UTF-8). */
    public static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by every JRE", e);
        }
    }

    /**
     * {@code value} itself when it is short, otherwise {@code "sha256:" + hash}: bounds the size of a
     * Redis key built from caller-influenced input while keeping ordinary keys readable.
     */
    public static String boundedKeyPart(String value) {
        String raw = value == null ? "" : value;
        return raw.length() <= MAX_RAW_KEY_LENGTH ? raw : "sha256:" + sha256Hex(raw);
    }
}
