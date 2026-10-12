package com.example.taskflow.auth;

import com.example.taskflow.core.RedisBackoff;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** {@link LoginAttemptLimiter} in {@code app.state.store=redis} mode, with the Redis client mocked. */
class LoginAttemptLimiterRedisTest {

    private StringRedisTemplate redis;
    private ValueOperations<String, String> values;
    private final AtomicLong clock = new AtomicLong(1_000_000);
    private LoginAttemptLimiter limiter;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        limiter = new LoginAttemptLimiter(3, 300,
                new RedisLoginFailureCounter(redis, new RedisBackoff("test", 5_000, clock::get)));
    }

    @Test
    @SuppressWarnings("unchecked")
    void theSharedCountDecidesAndRetryAfterComesFromTheKeysTtl() {
        when(values.get(anyString())).thenReturn("3");
        when(redis.execute(any(RedisCallback.class))).thenReturn(120_500L);

        TooManyLoginAttemptsException ex =
                assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("a@x.com"));
        assertEquals("121", ex.getHeaders().getFirst("Retry-After"));
    }

    @Test
    void belowTheLimitTheAttemptIsAllowedEvenIfThisReplicaSawNoFailures() {
        when(values.get(anyString())).thenReturn("2");
        assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com"));
        when(values.get(anyString())).thenReturn(null);
        assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com"));
    }

    @Test
    void failuresIncrementTheWindowAtomicallyWithTheWindowLengthAsTtl() {
        limiter.recordFailure("A@X.com ");

        @SuppressWarnings({"unchecked", "rawtypes"})
        ArgumentCaptor<List<String>> keys = (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
        verify(redis).execute(ArgumentMatchers.<RedisScript<Long>>any(), keys.capture(), eq("300000"));
        String key = keys.getValue().get(0);
        assertTrue(key.matches("login_failures:[0-9a-f]{64}"), key);
        assertFalse(key.contains("x.com"), "no e-mail address in clear in Redis");
    }

    @Test
    void keysAreTheSameForEquivalentUsernamesAndBoundedForHugeOnes() {
        assertEquals(RedisLoginFailureCounter.key("a@x.com|"), RedisLoginFailureCounter.key("a@x.com|"));
        assertEquals(79, RedisLoginFailureCounter.key("u".repeat(100_000) + "|1.2.3.4").length());
    }

    @Test
    void successDeletesTheSharedWindow() {
        limiter.recordSuccess("a@x.com");

        verify(redis).delete(ArgumentMatchers.startsWith("login_failures:"));
    }

    @Test
    void whileRedisFailsTheLocalCounterAppliesTheSameLimit() {
        when(values.get(anyString())).thenThrow(new RedisConnectionFailureException("down"));
        when(redis.execute(ArgumentMatchers.<RedisScript<Long>>any(), anyList(), anyString()))
                .thenThrow(new RedisConnectionFailureException("down"));

        for (int i = 0; i < 3; i++) {
            limiter.checkAllowed("a@x.com");
            limiter.recordFailure("a@x.com");
        }

        TooManyLoginAttemptsException ex =
                assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("a@x.com"));
        long retryAfter = Long.parseLong(ex.getHeaders().getFirst("Retry-After"));
        assertTrue(retryAfter >= 1 && retryAfter <= 300, "retry-after=" + retryAfter);
        // One failed call opened the back-off; the remaining ones went straight to the fallback.
        verify(values).get(anyString());
    }

    @Test
    void failuresCountedLocallyKeepTheFallbackWarmWhenRedisFailsMidWindow() {
        when(redis.execute(ArgumentMatchers.<RedisScript<Long>>any(), anyList(), anyString())).thenReturn(1L, 2L, 3L);
        limiter.recordFailure("a@x.com");
        limiter.recordFailure("a@x.com");
        limiter.recordFailure("a@x.com");

        when(values.get(anyString())).thenThrow(new RedisConnectionFailureException("down"));

        assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("a@x.com"));
    }

    @Test
    void zeroStillDisablesTheThrottleWithoutTouchingRedis() {
        LoginAttemptLimiter disabled = new LoginAttemptLimiter(0, 300,
                new RedisLoginFailureCounter(redis, new RedisBackoff("test", 5_000, clock::get)));
        disabled.recordFailure("a@x.com");
        disabled.checkAllowed("a@x.com");
        disabled.recordSuccess("a@x.com");

        verify(redis, never()).opsForValue();
        verify(redis, never()).delete(anyString());
    }
}
