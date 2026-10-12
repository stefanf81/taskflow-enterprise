package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.concurrent.ConcurrentMapCache;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The cross-replica path of {@link SingleFlightCacheManager}: two manager instances over one shared
 * store stand in for two replicas over one Redis. The lock here is an in-memory fake; the same
 * scenarios run against a real Redis in {@code AbstractRedisCacheLoadLockTest}.
 */
class SingleFlightDistributedLockTest {

    /** A cache with no mutual exclusion in get(key, loader), like RedisCache with the default writer. */
    private static final class NaiveCache extends ConcurrentMapCache {
        NaiveCache(String name, ConcurrentHashMap<Object, Object> store) {
            super(name, store, true);
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> T get(Object key, Callable<T> valueLoader) {
            ValueWrapper hit = get(key);
            if (hit != null) {
                return (T) hit.get();
            }
            try {
                T value = valueLoader.call();
                put(key, value);
                return value;
            } catch (Exception e) {
                throw new ValueRetrievalException(key, valueLoader, e);
            }
        }
    }

    /** Two "replicas" share the backing map, as two RedisCacheManagers share one Redis. */
    private static CacheManager sharedNaiveManager(ConcurrentHashMap<Object, Object> store) {
        return new ConcurrentMapCacheManager() {
            @Override
            protected Cache createConcurrentMapCache(String name) {
                return new NaiveCache(name, store);
            }
        };
    }

    /** In-memory stand-in for SET NX PX + compare-and-delete. */
    private static final class FakeLock implements SingleFlightCacheManager.DistributedLoadLock {
        final ConcurrentHashMap<String, String> held = new ConcurrentHashMap<>();
        final AtomicInteger acquireAttempts = new AtomicInteger();
        final AtomicInteger releases = new AtomicInteger();

        @Override
        public String tryAcquire(String cacheName, Object key) {
            acquireAttempts.incrementAndGet();
            String token = UUID.randomUUID().toString();
            return held.putIfAbsent(cacheName + ":" + key, token) == null ? token : null;
        }

        @Override
        public void release(String cacheName, Object key, String token) {
            releases.incrementAndGet();
            held.remove(cacheName + ":" + key, token);
        }
    }

    @Test
    void concurrentMissesOnTwoReplicasRunTheLoaderOnceAndReleaseTheLease() throws Exception {
        ConcurrentHashMap<Object, Object> redis = new ConcurrentHashMap<>();
        FakeLock lock = new FakeLock();
        Cache replicaA = new SingleFlightCacheManager(sharedNaiveManager(redis), lock, Duration.ofSeconds(5))
                .getCache("services");
        Cache replicaB = new SingleFlightCacheManager(sharedNaiveManager(redis), lock, Duration.ofSeconds(5))
                .getCache("services");
        AtomicInteger loads = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(16);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < 16; i++) {
            Cache cache = i % 2 == 0 ? replicaA : replicaB;
            results.add(pool.submit(() -> {
                go.await();
                return cache.get("all", () -> {
                    loads.incrementAndGet();
                    Thread.sleep(200);
                    return "list";
                });
            }));
        }
        go.countDown();
        for (Future<String> result : results) {
            assertEquals("list", result.get(10, TimeUnit.SECONDS));
        }
        pool.shutdownNow();

        assertEquals(1, loads.get(), "one load for the whole deployment");
        assertTrue(lock.held.isEmpty(), "the winner released its lease");
        // The local lock in front means each JVM sends one acquire per round, not one per thread.
        assertTrue(lock.acquireAttempts.get() <= 2 + 2 * 20, "attempts=" + lock.acquireAttempts.get());
    }

    @Test
    void aLoserTakesOverAtOnceWhenTheWinnersLoadFails() throws Exception {
        ConcurrentHashMap<Object, Object> redis = new ConcurrentHashMap<>();
        FakeLock lock = new FakeLock();
        Cache replicaA = new SingleFlightCacheManager(sharedNaiveManager(redis), lock, Duration.ofSeconds(5))
                .getCache("services");
        Cache replicaB = new SingleFlightCacheManager(sharedNaiveManager(redis), lock, Duration.ofSeconds(5))
                .getCache("services");
        CountDownLatch winnerLoading = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        Future<?> winner = pool.submit(() -> replicaA.get("k", () -> {
            winnerLoading.countDown();
            Thread.sleep(200);
            throw new IllegalStateException("db down");
        }));
        assertTrue(winnerLoading.await(5, TimeUnit.SECONDS));
        long start = System.nanoTime();
        Future<String> loser = pool.submit(() -> replicaB.get("k", () -> "loaded-by-b"));

        assertEquals("loaded-by-b", loser.get(5, TimeUnit.SECONDS));
        assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 2_000,
                "the loser did not sit out max-wait");
        assertThrows(java.util.concurrent.ExecutionException.class, () -> winner.get(5, TimeUnit.SECONDS));
        pool.shutdownNow();
        assertTrue(lock.held.isEmpty());
    }

    @Test
    void aLeaseThatIsNeverReleasedCostsAtMostMaxWait() {
        FakeLock lock = new FakeLock();
        lock.held.put("services:k", "a-replica-that-died");
        Cache cache = new SingleFlightCacheManager(sharedNaiveManager(new ConcurrentHashMap<>()), lock,
                Duration.ofMillis(300)).getCache("services");
        AtomicInteger loads = new AtomicInteger();

        long start = System.nanoTime();
        assertEquals("v", cache.get("k", () -> {
            loads.incrementAndGet();
            return "v";
        }));
        long elapsed = Duration.ofNanos(System.nanoTime() - start).toMillis();

        assertEquals(1, loads.get());
        assertTrue(elapsed >= 250 && elapsed < 3_000, "elapsed=" + elapsed);
        assertEquals("a-replica-that-died", lock.held.get("services:k"), "someone else's lease is not touched");
    }

    @Test
    void aValuePublishedByTheWinnerIsReturnedWithoutLoading() throws Exception {
        ConcurrentHashMap<Object, Object> redis = new ConcurrentHashMap<>();
        FakeLock lock = new FakeLock();
        lock.held.put("services:k", "other-replica");
        Cache cache = new SingleFlightCacheManager(sharedNaiveManager(redis), lock, Duration.ofSeconds(5))
                .getCache("services");
        ExecutorService pool = Executors.newSingleThreadExecutor();
        Future<String> waiting = pool.submit(() -> cache.get("k", () -> {
            throw new AssertionError("the loser must not load");
        }));

        Thread.sleep(100);
        redis.put("k", "from-other-replica"); // the winner writes ...
        lock.held.remove("services:k");        // ... and releases

        assertEquals("from-other-replica", waiting.get(5, TimeUnit.SECONDS));
        pool.shutdownNow();
    }

    @Test
    void aFailingLockFallsBackToLoadingDirectly() {
        SingleFlightCacheManager.DistributedLoadLock broken = new SingleFlightCacheManager.DistributedLoadLock() {
            @Override
            public String tryAcquire(String cacheName, Object key) {
                throw new IllegalStateException("redis down");
            }

            @Override
            public void release(String cacheName, Object key, String token) {
                throw new AssertionError("nothing was acquired");
            }
        };
        Cache cache = new SingleFlightCacheManager(sharedNaiveManager(new ConcurrentHashMap<>()), broken,
                Duration.ofSeconds(5)).getCache("services");

        assertEquals("v", cache.get("k", () -> "v"));
        assertEquals("v", cache.get("k", () -> "unused"), "and the value is cached as usual");
    }

    @Test
    void anUnreachableRedisMakesTheRealLockFallBackQuicklyAndOnlyOnce() {
        // Port 1: connection refused at once. Nothing is mocked: this is the production lock class.
        LettuceConnectionFactory factory = new LettuceConnectionFactory("127.0.0.1", 1);
        factory.afterPropertiesSet();
        factory.start();
        try {
            StringRedisTemplate template = new StringRedisTemplate(factory);
            RedisCacheLoadLock lock = new RedisCacheLoadLock(() -> template, Duration.ofSeconds(10));
            Cache cache = new SingleFlightCacheManager(sharedNaiveManager(new ConcurrentHashMap<>()), lock,
                    Duration.ofSeconds(5)).getCache("services");

            assertEquals("a", cache.get("a", () -> "a"));
            long start = System.nanoTime();
            for (int i = 0; i < 50; i++) {
                String key = "k" + i;
                assertEquals(key, cache.get(key, () -> key));
            }
            assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 1_000,
                    "within the back-off Redis is not asked again");
            assertThrows(RuntimeException.class, () -> lock.tryAcquire("services", "x"));
        } finally {
            factory.destroy();
        }
    }

    @Test
    void lockKeysAreBounded() {
        assertEquals("lock:services:all", RedisCacheLoadLock.lockKey("services", "all"));
        String huge = "x".repeat(10_000);
        String key = RedisCacheLoadLock.lockKey("busySlots", huge);
        assertTrue(key.startsWith("lock:busySlots:sha256:") && key.length() < 100, key);
    }
}
