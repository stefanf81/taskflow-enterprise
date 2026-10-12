package com.example.taskflow.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** {@link RedisCacheLoadLock} with the Redis client mocked (the real-Redis cases are elsewhere). */
class RedisCacheLoadLockTest {

    private StringRedisTemplate redis;
    private ValueOperations<String, String> values;
    private final AtomicLong clock = new AtomicLong(1_000_000);
    private RedisCacheLoadLock lock;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        lock = new RedisCacheLoadLock(() -> redis, Duration.ofSeconds(10), new RedisBackoff("test", 5_000, clock::get));
    }

    @Test
    void acquireIsSetNxWithTheLeaseAndReturnsAToken() {
        when(values.setIfAbsent(eq("lock:services:all"), anyString(), eq(Duration.ofSeconds(10)))).thenReturn(true);

        assertNotNull(lock.tryAcquire("services", "all"));
    }

    @Test
    void aLeaseHeldElsewhereYieldsNull() {
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(false);

        assertNull(lock.tryAcquire("services", "all"));
    }

    @Test
    void releaseIsACompareAndDeleteWithTheHoldersToken() {
        lock.release("services", "all", "my-token");

        verify(redis).execute(ArgumentMatchers.<RedisScript<Long>>any(), eq(List.of("lock:services:all")),
                eq("my-token"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aRedisErrorThrowsAndBacksOffSoTheNextMissDoesNotWaitForRedisAgain() {
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class)))
                .thenThrow(new RedisConnectionFailureException("down"));

        assertThrows(RuntimeException.class, () -> lock.tryAcquire("services", "all"));
        assertThrows(RuntimeException.class, () -> lock.tryAcquire("services", "all"));
        verify(values, times(1)).setIfAbsent(anyString(), anyString(), any(Duration.class));

        assertDoesNotThrow(() -> lock.release("services", "all", "t"));
        verify(redis, never()).execute(ArgumentMatchers.<RedisScript<Long>>any(), any(), any());

        clock.addAndGet(5_001);
        org.mockito.Mockito.reset(values);
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(true);
        assertNotNull(lock.tryAcquire("services", "all"), "retried after the back-off");
    }

    @Test
    void releaseNeverThrows() {
        when(redis.execute(ArgumentMatchers.<RedisScript<Long>>any(), any(), any()))
                .thenThrow(new RedisConnectionFailureException("down"));

        assertDoesNotThrow(() -> lock.release("services", "all", "t"));
    }

    @Test
    void theLeaseMustBePositive() {
        assertThrows(IllegalArgumentException.class, () -> new RedisCacheLoadLock(() -> redis, Duration.ZERO));
        assertEquals(Duration.ofSeconds(10), lock.getLease());
    }
}
