package com.example.taskflow.core;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import java.time.Duration;
import java.util.Collections;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Cross-replica lease for {@link SingleFlightCacheManager}: {@code SET lock:<cache>:<key> <token> NX PX
 * <lease>} to acquire, a compare-and-delete Lua script to release (a holder whose lease already
 * expired and was taken over can never delete the new holder's lock). Every key has a TTL, so a
 * holder that dies only blocks the key for one lease.
 *
 * <p>Key parts longer than 128 characters are replaced by their SHA-256 ({@link
 * SharedStateStore#boundedKeyPart}). Redis errors go through a {@link RedisBackoff}: while it backs
 * off, {@link #tryAcquire} throws immediately and the caller loads without the lease. The template
 * is resolved lazily (first miss), so creating this lock never touches Redis.
 */
public final class RedisCacheLoadLock implements SingleFlightCacheManager.DistributedLoadLock {

    static final String KEY_PREFIX = "lock:";
    public static final Duration DEFAULT_LEASE = Duration.ofSeconds(10);

    private static final DefaultRedisScript<Long> RELEASE_SCRIPT;

    static {
        // KEYS[1]=lock:<cache>:<key>  ARGV[1]=token of the releasing holder
        String lua = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end; "
                + "return 0";
        RELEASE_SCRIPT = new DefaultRedisScript<>();
        RELEASE_SCRIPT.setScriptText(lua);
        RELEASE_SCRIPT.setResultType(Long.class);
    }

    /** Thrown (without a stack trace) when the lock store cannot be used; the caller loads directly. */
    static final class LockUnavailableException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        LockUnavailableException() {
            super("cache load lock unavailable", null, false, false);
        }
    }

    private final Supplier<StringRedisTemplate> redisSupplier;
    private final Duration lease;
    private final RedisBackoff backoff;
    private volatile StringRedisTemplate redis;

    public RedisCacheLoadLock(Supplier<StringRedisTemplate> redis, Duration lease) {
        this(redis, lease, new RedisBackoff("Cache load lock"));
    }

    RedisCacheLoadLock(Supplier<StringRedisTemplate> redis, Duration lease, RedisBackoff backoff) {
        if (lease.toMillis() <= 0) {
            throw new IllegalArgumentException("lease must be positive");
        }
        this.redisSupplier = redis;
        this.lease = lease;
        this.backoff = backoff;
    }

    @Override
    public String tryAcquire(String cacheName, Object key) {
        if (!backoff.isAvailable()) {
            throw new LockUnavailableException();
        }
        String token = UUID.randomUUID().toString();
        try {
            Boolean acquired = template().opsForValue().setIfAbsent(lockKey(cacheName, key), token, lease);
            backoff.recordSuccess();
            return Boolean.TRUE.equals(acquired) ? token : null;
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
            throw new LockUnavailableException();
        }
    }

    @Override
    public void release(String cacheName, Object key, String token) {
        if (!backoff.isAvailable()) {
            return; // the lease expires on its own
        }
        try {
            template().execute(RELEASE_SCRIPT, Collections.singletonList(lockKey(cacheName, key)), token);
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
        }
    }

    public Duration getLease() {
        return lease;
    }

    private StringRedisTemplate template() {
        StringRedisTemplate template = redis;
        if (template == null) {
            template = redisSupplier.get();
            redis = template;
        }
        return template;
    }

    static String lockKey(String cacheName, Object key) {
        return KEY_PREFIX + SharedStateStore.boundedKeyPart(cacheName) + ":"
                + SharedStateStore.boundedKeyPart(String.valueOf(key));
    }
}
