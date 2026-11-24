package com.example.taskflow.core.cache;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.concurrent.ConcurrentMapCache;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;

/**
 * BKG-7: {@code sync = true} must give single-flight loading on the Redis manager too. The delegate
 * used here deliberately mimics Spring Data Redis' non-locking behaviour: its {@code get(key, loader)}
 * has no mutual exclusion, so any serialisation observed comes from {@link SingleFlightCacheManager}.
 */
class SingleFlightCacheManagerTest {

    /** A cache whose get(key, loader) is NOT synchronised, like RedisCache with the default writer. */
    private static class NaiveCache extends ConcurrentMapCache {
        NaiveCache(String name) {
            super(name);
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

    private static CacheManager naiveManager() {
        return new ConcurrentMapCacheManager() {
            @Override
            protected Cache createConcurrentMapCache(String name) {
                return new NaiveCache(name);
            }
        };
    }

    @Test
    void manyThreadsHittingOneMissingKeyRunTheLoaderExactlyOnce() throws Exception {
        Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("barbers");
        int threads = 32;
        AtomicInteger loads = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            results.add(pool.submit(() -> {
                go.await();
                return cache.get("all", () -> {
                    loads.incrementAndGet();
                    Thread.sleep(150); // a slow DB query: everyone else piles up behind it
                    return "value";
                });
            }));
        }
        go.countDown();
        for (Future<String> result : results) {
            assertEquals("value", result.get(10, TimeUnit.SECONDS));
        }
        pool.shutdownNow();

        assertEquals(1, loads.get(), "loader must run once for one missing key");
    }

    @Test
    void withoutTheDecoratorTheNaiveDelegateWouldStampede() throws Exception {
        // Control experiment: proves the test above is meaningful (the delegate alone loads many times).
        Cache raw = naiveManager().getCache("barbers");
        int threads = 16;
        AtomicInteger loads = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<?>> results = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            results.add(pool.submit(() -> {
                go.await();
                return raw.get("all", () -> {
                    loads.incrementAndGet();
                    Thread.sleep(150);
                    return "value";
                });
            }));
        }
        go.countDown();
        for (Future<?> result : results) {
            result.get(10, TimeUnit.SECONDS);
        }
        pool.shutdownNow();

        assertTrue(loads.get() > 1, "naive delegate stampedes: " + loads.get());
    }

    @Test
    void differentKeysDoNotBlockEachOther() throws Exception {
        Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("barbers");
        CountDownLatch slowStarted = new CountDownLatch(1);
        CountDownLatch releaseSlow = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        Future<String> slow = pool.submit(() -> cache.get("slow", () -> {
            slowStarted.countDown();
            releaseSlow.await(10, TimeUnit.SECONDS);
            return "slow-value";
        }));
        assertTrue(slowStarted.await(5, TimeUnit.SECONDS));

        // while "slow" is still loading, an unrelated key loads immediately
        Future<String> fast = pool.submit(() -> cache.get("fast", () -> "fast-value"));
        assertEquals("fast-value", fast.get(2, TimeUnit.SECONDS));

        releaseSlow.countDown();
        assertEquals("slow-value", slow.get(5, TimeUnit.SECONDS));
        pool.shutdownNow();
    }

    @Test
    void aFailingLoaderReleasesTheLockAndTheNextCallerRetries() {
        SingleFlightCacheManager manager = new SingleFlightCacheManager(naiveManager());
        Cache cache = manager.getCache("barbers");

        Cache.ValueRetrievalException failure = assertThrows(
                Cache.ValueRetrievalException.class,
                () -> cache.get("k", () -> {
                    throw new IllegalStateException("db down");
                }));
        assertInstanceOf(IllegalStateException.class, failure.getCause());

        // the key is not poisoned and not left locked
        assertEquals("recovered", cache.get("k", () -> "recovered"));
        assertEquals(
                0,
                ((SingleFlightCacheManager.SingleFlightCache) cache).activeLockCount(),
                "no per-key lock entries may leak");
    }

    @Test
    void waitersOfAFailedLoadEachRetryInsteadOfHangingOrSharingTheFailure() throws Exception {
        Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("barbers");
        AtomicInteger attempts = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        List<Future<String>> results = new ArrayList<>();
        CountDownLatch go = new CountDownLatch(1);
        for (int i = 0; i < 4; i++) {
            results.add(pool.submit(() -> {
                go.await();
                try {
                    return cache.get("k", () -> {
                        if (attempts.incrementAndGet() == 1) {
                            Thread.sleep(100);
                            throw new IllegalStateException("first load fails");
                        }
                        return "ok";
                    });
                } catch (Cache.ValueRetrievalException e) {
                    return "failed";
                }
            }));
        }
        go.countDown();
        int failed = 0;
        for (Future<String> result : results) {
            if ("failed".equals(result.get(10, TimeUnit.SECONDS))) {
                failed++;
            }
        }
        pool.shutdownNow();

        assertEquals(1, failed, "only the caller whose own load failed sees the failure");
        assertEquals("ok", cache.get("k", () -> "unused"));
    }

    /**
     * The database is down: every load waits out the pool's connection timeout (here 200 ms) and
     * fails. Waiters used to load again one after another, so the last of 12 callers waited 12
     * timeouts (BENCHMARKS.md §80). Now each waits for the load under way and one more.
     */
    @Test
    void duringAnOutageNoCallerWaitsLongerThanTwoLoads() throws Exception {
        Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("barbers");
        AtomicInteger loads = new AtomicInteger();
        int callers = 12;
        long loadMillis = 200;
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Long>> waits = new ArrayList<>();
        try (ExecutorService requests = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < callers; i++) {
                waits.add(requests.submit(() -> {
                    go.await();
                    long start = System.nanoTime();
                    assertThrows(
                            Cache.ValueRetrievalException.class,
                            () -> cache.get("k", () -> {
                                loads.incrementAndGet();
                                Thread.sleep(loadMillis);
                                throw new IllegalStateException("connection is not available");
                            }));
                    return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
                }));
            }
            go.countDown();
            long longest = 0;
            for (Future<Long> wait : waits) {
                longest = Math.max(longest, wait.get(30, TimeUnit.SECONDS));
            }

            assertTrue(longest < 4 * loadMillis, "the slowest caller waited " + longest + " ms");
            assertTrue(loads.get() <= 3, "loads: " + loads.get());
        }
        assertEquals(0, ((SingleFlightCacheManager.SingleFlightCache) cache).activeLockCount());
    }

    @Test
    void waitersShareTheValueOfTheLoadUnderWay() throws Exception {
        Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("barbers");
        AtomicInteger loads = new AtomicInteger();
        CountDownLatch loading = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (ExecutorService requests = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<String> first = requests.submit(() -> cache.get("k", () -> {
                loads.incrementAndGet();
                loading.countDown();
                release.await();
                return "v";
            }));
            loading.await();
            List<Future<String>> others = new ArrayList<>();
            for (int i = 0; i < 5; i++) {
                others.add(requests.submit(() -> cache.get("k", () -> {
                    loads.incrementAndGet();
                    return "other";
                })));
            }
            Thread.sleep(100);
            release.countDown();
            assertEquals("v", first.get(5, TimeUnit.SECONDS));
            for (Future<String> other : others) {
                assertEquals("v", other.get(5, TimeUnit.SECONDS));
            }
        }
        assertEquals(1, loads.get());
    }

    @Test
    void aLoaderThatReadsItsOwnKeyDoesNotWaitForItself() {
        Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("barbers");

        String value = cache.get("k", () -> "outer:" + cache.get("k", () -> "inner"));

        assertEquals("outer:inner", value);
    }

    /**
     * A waiter woken by the failure of the flight it waited for must not find that finished flight
     * again and take it for a second failure. With the flight removed only after its outcome was
     * published, 345 of 500 such rounds failed more than one caller (BENCHMARKS.md §80).
     */
    @Test
    void aFailedFlightIsNeverJoinedAgainByTheWaitersItWoke() throws Exception {
        for (int round = 0; round < 200; round++) {
            Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("barbers");
            AtomicInteger attempts = new AtomicInteger();
            CountDownLatch go = new CountDownLatch(1);
            List<Future<String>> results = new ArrayList<>();
            try (ExecutorService pool = Executors.newFixedThreadPool(8)) {
                for (int i = 0; i < 8; i++) {
                    results.add(pool.submit(() -> {
                        go.await();
                        try {
                            return cache.get("k", () -> {
                                if (attempts.incrementAndGet() == 1) {
                                    Thread.sleep(5);
                                    throw new IllegalStateException("first load fails");
                                }
                                return "ok";
                            });
                        } catch (Cache.ValueRetrievalException e) {
                            return "failed";
                        }
                    }));
                }
                go.countDown();
                int failed = 0;
                for (Future<String> result : results) {
                    if ("failed".equals(result.get(10, TimeUnit.SECONDS))) {
                        failed++;
                    }
                }
                assertEquals(1, failed, "round " + round);
            }
        }
    }

    @Test
    void cachedValuesAreServedWithoutRunningTheLoader() {
        Cache cache = new SingleFlightCacheManager(naiveManager()).getCache("services");
        cache.put("k", "cached");

        assertEquals("cached", cache.get("k", () -> {
            throw new AssertionError("loader must not run on a hit");
        }));
    }

    @Test
    void everyOtherCacheOperationIsDelegated() {
        CacheManager target = naiveManager();
        SingleFlightCacheManager manager = new SingleFlightCacheManager(target);
        Cache cache = manager.getCache("busySlots");

        cache.put("a", 1);
        assertEquals(1, cache.get("a", Integer.class));
        assertEquals(1, target.getCache("busySlots").get("a").get());
        assertEquals("busySlots", cache.getName());
        assertSame(target.getCache("busySlots").getNativeCache(), cache.getNativeCache());
        cache.evict("a");
        assertEquals(null, cache.get("a"));
        cache.put("b", 2);
        cache.clear();
        assertEquals(null, cache.get("b"));
        assertEquals(target.getCacheNames(), manager.getCacheNames());
        assertSame(cache, manager.getCache("busySlots"), "wrapper instances are stable per cache name");
    }

    @Test
    void unknownCachesStayNull() {
        CacheManager noDynamic = new ConcurrentMapCacheManager();
        ((ConcurrentMapCacheManager) noDynamic).setCacheNames(List.of("known"));

        SingleFlightCacheManager manager = new SingleFlightCacheManager(noDynamic);

        assertNotNull(manager.getCache("known"));
        assertEquals(null, manager.getCache("nope"));
    }

    /** A service whose cached method is slow, called through Spring's real caching proxy. */
    static class SlowCatalog {
        private final AtomicInteger loads = new AtomicInteger();

        public int loadCount() {
            return loads.get();
        }

        @org.springframework.cache.annotation.Cacheable(value = "services", sync = true)
        public String all() throws InterruptedException {
            loads.incrementAndGet();
            Thread.sleep(150);
            return "list";
        }
    }

    @org.springframework.context.annotation.Configuration
    @org.springframework.cache.annotation.EnableCaching
    static class CachingConfig {
        @org.springframework.context.annotation.Bean
        CacheManager cacheManager() {
            return new SingleFlightCacheManager(naiveManager());
        }

        @org.springframework.context.annotation.Bean
        SlowCatalog slowCatalog() {
            return new SlowCatalog();
        }
    }

    @Test
    void cacheableSyncThroughTheSpringProxyIsSingleFlightOnAManagerWithoutNativeSyncSupport() throws Exception {
        try (var context =
                new org.springframework.context.annotation.AnnotationConfigApplicationContext(CachingConfig.class)) {
            SlowCatalog catalog = context.getBean(SlowCatalog.class);
            ExecutorService pool = Executors.newFixedThreadPool(24);
            CountDownLatch go = new CountDownLatch(1);
            List<Future<String>> results = new ArrayList<>();
            for (int i = 0; i < 24; i++) {
                results.add(pool.submit(() -> {
                    go.await();
                    return catalog.all();
                }));
            }
            go.countDown();
            for (Future<String> result : results) {
                assertEquals("list", result.get(10, TimeUnit.SECONDS));
            }
            pool.shutdownNow();

            assertEquals(1, catalog.loadCount(), "@Cacheable(sync=true) must load once per cold key");
        }
    }

    @Test
    void configWrapsOnlyTheRedisCacheManager() {
        BeanPostProcessor processor = CacheConfig.singleFlightCacheManagerPostProcessor(
                new org.springframework.mock.env.MockEnvironment(), neverResolvedTemplate());
        RedisCacheManager redis =
                RedisCacheManager.builder(mock(RedisConnectionFactory.class)).build();
        CacheManager simple = new ConcurrentMapCacheManager();

        Object wrapped = processor.postProcessAfterInitialization(redis, "cacheManager");
        assertInstanceOf(SingleFlightCacheManager.class, wrapped);
        CacheManager beneath = ((SingleFlightCacheManager) wrapped).getDelegate();
        assertInstanceOf(RedisBackoffCacheManager.class, beneath, "reads skip a failing Redis");
        assertSame(redis, ((RedisBackoffCacheManager) beneath).getDelegate());
        assertEquals(
                null,
                ((SingleFlightCacheManager) wrapped).getDistributedLock(),
                "app.state.store=memory (default): per-JVM single flight only");

        assertSame(
                simple,
                processor.postProcessAfterInitialization(simple, "cacheManager"),
                "the dev/test 'simple' manager already serialises and is left alone");
        Object other = new Object();
        assertSame(other, processor.postProcessAfterInitialization(other, "somethingElse"));
    }

    @Test
    void withTheRedisStateStoreTheWrapperAlsoTakesACrossReplicaLeaseWithoutTouchingRedisAtStartup() {
        var environment = new org.springframework.mock.env.MockEnvironment()
                .withProperty("app.state.store", "redis")
                .withProperty("app.cache.single-flight.lock-lease-ms", "2500");
        BeanPostProcessor processor =
                CacheConfig.singleFlightCacheManagerPostProcessor(environment, neverResolvedTemplate());
        RedisCacheManager redis =
                RedisCacheManager.builder(mock(RedisConnectionFactory.class)).build();

        SingleFlightCacheManager wrapped =
                (SingleFlightCacheManager) processor.postProcessAfterInitialization(redis, "cacheManager");

        RedisCacheLoadLock lock = assertInstanceOf(RedisCacheLoadLock.class, wrapped.getDistributedLock());
        assertEquals(java.time.Duration.ofMillis(2500), lock.getLease());
    }

    /** Fails the test if the template is resolved: creating the post-processor must stay offline. */
    @SuppressWarnings("unchecked")
    private static org.springframework.beans.factory.ObjectProvider<
                    org.springframework.data.redis.core.StringRedisTemplate>
            neverResolvedTemplate() {
        var provider = mock(org.springframework.beans.factory.ObjectProvider.class);
        org.mockito.Mockito.when(provider.getObject()).thenThrow(new AssertionError("resolved at startup"));
        return provider;
    }
}
