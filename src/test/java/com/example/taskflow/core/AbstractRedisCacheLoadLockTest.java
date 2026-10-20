package com.example.taskflow.core;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link SingleFlightCacheManager} + {@link RedisCacheLoadLock} over the production
 * {@link RedisCacheManager} configuration, against a real Redis. Two manager instances with their
 * own connection factories are two replicas. Closes the "wrapping is untested against a live Redis"
 * gap. Every test uses fresh keys, so a shared scratch server is fine; nothing is flushed.
 */
abstract class AbstractRedisCacheLoadLockTest {

    private static final String CACHE = "services";

    protected abstract String redisUrl();

    private LettuceConnectionFactory factoryA;
    private LettuceConnectionFactory factoryB;
    private StringRedisTemplate redis;
    private String key;

    @BeforeEach
    void connect() {
        factoryA = RedisTestSupport.connect(redisUrl());
        factoryB = RedisTestSupport.connect(redisUrl());
        redis = new StringRedisTemplate(factoryA);
        key = "all-" + UUID.randomUUID();
    }

    @AfterEach
    void disconnect() {
        redis.delete(List.of(CACHE + "::" + key, lockKey()));
        factoryA.destroy();
        factoryB.destroy();
    }

    private String lockKey() {
        return "lock:" + CACHE + ":" + key;
    }

    /** One replica: the production cache configuration, wrapped exactly as CacheConfig does. */
    private Cache replica(LettuceConnectionFactory factory, Duration lease, Duration maxWait) {
        return replica(factory, lease, maxWait, new CacheConfig().cacheConfiguration());
    }

    private Cache replica(LettuceConnectionFactory factory, Duration lease, Duration maxWait,
                          RedisCacheConfiguration configuration) {
        RedisCacheManager manager = RedisCacheManager.builder(factory)
                .cacheDefaults(configuration)
                .build();
        manager.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(factory);
        Object wrapped = CacheConfig.singleFlightPostProcessor(new RedisCacheLoadLock(() -> template, lease), maxWait)
                .postProcessAfterInitialization(manager, "cacheManager");
        return ((SingleFlightCacheManager) wrapped).getCache(CACHE);
    }

    @Test
    void concurrentMissesOnTwoReplicasRunTheLoaderOnceStoreTheValueAndReleaseTheLock() throws Exception {
        Cache a = replica(factoryA, Duration.ofSeconds(10), Duration.ofSeconds(5));
        Cache b = replica(factoryB, Duration.ofSeconds(10), Duration.ofSeconds(5));
        AtomicInteger loads = new AtomicInteger();
        int callers = 16;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < callers; i++) {
            Cache cache = i % 2 == 0 ? a : b;
            results.add(pool.submit(() -> {
                go.await();
                return cache.get(key, () -> {
                    loads.incrementAndGet();
                    Thread.sleep(300); // a slow query: every other caller on both replicas piles up
                    return "catalog";
                });
            }));
        }
        go.countDown();
        for (Future<String> result : results) {
            assertEquals("catalog", result.get(15, TimeUnit.SECONDS));
        }
        pool.shutdownNow();

        assertEquals(1, loads.get(), "one load across both replicas");
        assertFalse(Boolean.TRUE.equals(redis.hasKey(lockKey())), "the winner released its lease");
        Long ttl = redis.getExpire(CACHE + "::" + key, TimeUnit.MILLISECONDS);
        assertNotNull(ttl);
        assertTrue(ttl > 0 && ttl <= Duration.ofMinutes(10).toMillis(), "cached with the cache TTL: " + ttl);
        assertEquals("catalog", b.get(key, () -> "unused"), "served from Redis afterwards");
    }

    /** A typed cache meets a value the former generic serializer wrote: reloaded and overwritten, never served as null. */
    @Test
    void anEntryInTheFormerFormatIsReloadedAndOverwritten() {
        String entry = CACHE + "::" + key;
        redis.opsForValue().set(entry, "[\"java.util.ImmutableCollections$List12\",[\"09:00\"]]", Duration.ofMinutes(1));
        Cache typed = replica(factoryA, Duration.ofSeconds(10), Duration.ofSeconds(5),
                CacheConfig.listCache(Duration.ofMinutes(2), String.class));
        AtomicInteger loads = new AtomicInteger();

        assertEquals(List.of("10:00"), typed.get(key, () -> {
            loads.incrementAndGet();
            return List.of("10:00");
        }));
        assertEquals("[\"10:00\"]", redis.opsForValue().get(entry), "overwritten in the typed format");
        assertEquals(List.of("10:00"), typed.get(key, () -> List.of("unused")));
        assertEquals(1, loads.get());
    }

    @Test
    void aLeaseLeftByADeadReplicaExpiresAndTheNextCallerLoads() {
        redis.opsForValue().set(lockKey(), "replica-that-died", Duration.ofMillis(700));
        Cache a = replica(factoryA, Duration.ofSeconds(10), Duration.ofSeconds(5));
        AtomicInteger loads = new AtomicInteger();

        long start = System.nanoTime();
        assertEquals("v", a.get(key, () -> {
            loads.incrementAndGet();
            return "v";
        }));
        long elapsed = Duration.ofNanos(System.nanoTime() - start).toMillis();

        assertEquals(1, loads.get());
        assertTrue(elapsed >= 500 && elapsed < 4_000, "waited for the lease, not for max-wait: " + elapsed);
        assertFalse(Boolean.TRUE.equals(redis.hasKey(lockKey())), "own lease released");
    }

    @Test
    void waitingForAnotherReplicaIsBoundedByMaxWait() {
        redis.opsForValue().set(lockKey(), "replica-that-hangs", Duration.ofSeconds(30));
        Cache a = replica(factoryA, Duration.ofSeconds(10), Duration.ofMillis(400));

        long start = System.nanoTime();
        assertEquals("v", a.get(key, () -> "v"));
        long elapsed = Duration.ofNanos(System.nanoTime() - start).toMillis();

        assertTrue(elapsed >= 350 && elapsed < 3_000, "elapsed=" + elapsed);
        assertEquals("replica-that-hangs", redis.opsForValue().get(lockKey()), "another holder's lease is not deleted");
    }

    @Test
    void whenTheWinnersLoadFailsALoserOnTheOtherReplicaTakesOverAtOnce() throws Exception {
        Cache a = replica(factoryA, Duration.ofSeconds(10), Duration.ofSeconds(5));
        Cache b = replica(factoryB, Duration.ofSeconds(10), Duration.ofSeconds(5));
        CountDownLatch winnerLoading = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        Future<?> winner = pool.submit(() -> a.get(key, () -> {
            winnerLoading.countDown();
            Thread.sleep(200);
            throw new IllegalStateException("db down");
        }));
        assertTrue(winnerLoading.await(5, TimeUnit.SECONDS));
        long start = System.nanoTime();
        Future<String> loser = pool.submit(() -> b.get(key, () -> "loaded-by-b"));

        assertEquals("loaded-by-b", loser.get(10, TimeUnit.SECONDS));
        assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 3_000);
        assertThrows(ExecutionException.class, () -> winner.get(5, TimeUnit.SECONDS));
        pool.shutdownNow();
        assertFalse(Boolean.TRUE.equals(redis.hasKey(lockKey())));
    }

    @Test
    void theLeaseHasATtlAndOnlyItsOwnerCanReleaseIt() {
        RedisCacheLoadLock lock = new RedisCacheLoadLock(() -> redis, Duration.ofSeconds(10));

        String token = lock.tryAcquire(CACHE, key);
        assertNotNull(token);
        Long ttl = redis.getExpire(lockKey(), TimeUnit.MILLISECONDS);
        assertTrue(ttl != null && ttl > 0 && ttl <= 10_000, "ttl=" + ttl);
        assertEquals(null, lock.tryAcquire(CACHE, key), "held");

        // The lease expired and someone else took over: a late release must not delete their lock.
        redis.opsForValue().set(lockKey(), "new-holder", Duration.ofSeconds(10));
        lock.release(CACHE, key, token);
        assertEquals("new-holder", redis.opsForValue().get(lockKey()));
    }
}
