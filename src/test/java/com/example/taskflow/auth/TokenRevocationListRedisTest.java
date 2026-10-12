package com.example.taskflow.auth;

import com.example.taskflow.core.RedisBackoff;
import com.example.taskflow.core.TokenRevokedEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** {@link TokenRevocationList} in {@code app.state.store=redis} mode, with the Redis client mocked. */
class TokenRevocationListRedisTest {

    private StringRedisTemplate redis;
    private ValueOperations<String, String> values;
    private ApplicationEventPublisher events;
    private final AtomicLong clock = new AtomicLong(1_000_000);
    private RedisTokenRevocationStore store;
    private TokenRevocationList list;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        events = mock(ApplicationEventPublisher.class);
        store = new RedisTokenRevocationStore(redis, new RedisBackoff("test", 5_000, clock::get));
        list = new TokenRevocationList(events, store);
    }

    @SuppressWarnings("unchecked")
    private void redisTtlIs(Long ttl) {
        when(redis.execute(any(RedisCallback.class))).thenReturn(ttl);
    }

    @SuppressWarnings("unchecked")
    private void redisLookupFails() {
        when(redis.execute(any(RedisCallback.class))).thenThrow(new RedisConnectionFailureException("down"));
    }

    @Test
    void revokeWritesTheJtiWithTheTokensRemainingLifetimeAndAnnouncesIt() {
        list.revoke("jti-1", Instant.now().plusSeconds(600));

        ArgumentCaptor<Duration> ttl = ArgumentCaptor.forClass(Duration.class);
        verify(values).set(eq("revoked:jti-1"), eq("1"), ttl.capture());
        assertTrue(ttl.getValue().toMillis() > 590_000 && ttl.getValue().toMillis() <= 600_000, ttl.getValue().toString());
        verify(redis).convertAndSend(eq(RedisTokenRevocationStore.CHANNEL), anyString());
        verify(events).publishEvent(new TokenRevokedEvent("jti-1"));
    }

    @Test
    void theKeyTtlHasAFloorSoAnAlmostExpiredTokenIsStillDenied() {
        list.revoke("jti-1", Instant.now().plusMillis(200));

        ArgumentCaptor<Duration> ttl = ArgumentCaptor.forClass(Duration.class);
        verify(values).set(eq("revoked:jti-1"), eq("1"), ttl.capture());
        assertEquals(RedisTokenRevocationStore.MIN_TTL_MILLIS, ttl.getValue().toMillis());
    }

    @Test
    @SuppressWarnings("unchecked")
    void aLocallyRevokedTokenIsAnsweredWithoutRedis() {
        list.revoke("jti-1", Instant.now().plusSeconds(60));

        assertTrue(list.isRevoked("jti-1"));
        verify(redis, never()).execute(any(RedisCallback.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aRevocationMadeOnAnotherReplicaIsFoundInRedisAndThenCachedLocally() {
        redisTtlIs(30_000L);

        assertTrue(list.isRevoked("jti-elsewhere"));
        assertTrue(list.isRevoked("jti-elsewhere"));
        verify(redis, times(1)).execute(any(RedisCallback.class));
    }

    @Test
    void aTokenUnknownToRedisIsNotRevoked() {
        redisTtlIs(-2L);

        assertFalse(list.isRevoked("jti-fresh"));
    }

    @Test
    void aKeyWithoutTtlStillCountsAsRevoked() {
        redisTtlIs(-1L);

        assertTrue(list.isRevoked("jti-odd"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aRedisOutageNeitherThrowsNorRejectsEveryTokenAndIsNotRetriedOnEveryRequest() {
        list.revoke("jti-local", Instant.now().plusSeconds(60)); // written before the outage
        redisLookupFails();

        assertDoesNotThrow(() -> assertFalse(list.isRevoked("jti-other")), "fails open to the local list");
        assertFalse(list.isRevoked("jti-other2"));
        assertTrue(list.isRevoked("jti-local"), "local revocations keep working");
        verify(redis, times(1)).execute(any(RedisCallback.class)); // the second lookup was in the back-off
    }

    @Test
    @SuppressWarnings("unchecked")
    void revocationsMadeWhileRedisIsDownAreKeptAndWrittenOnceItAnswersAgain() {
        org.mockito.Mockito.doThrow(new RedisConnectionFailureException("down"))
                .when(values).set(anyString(), anyString(), any(Duration.class));

        list.revoke("jti-1", Instant.now().plusSeconds(600));

        assertTrue(list.isRevoked("jti-1"), "denied locally right away");
        assertEquals(1, list.pendingCount());
        verify(events).publishEvent(new TokenRevokedEvent("jti-1"));
        verify(redis, never()).convertAndSend(anyString(), anyString());

        // Redis is back after the back-off.
        org.mockito.Mockito.reset(values);
        clock.addAndGet(5_001);
        redisTtlIs(-2L);
        assertFalse(list.isRevoked("jti-2"));

        verify(values).set(eq("revoked:jti-1"), eq("1"), any(Duration.class));
        verify(redis).convertAndSend(eq(RedisTokenRevocationStore.CHANNEL), anyString());
        assertEquals(0, list.pendingCount());
    }

    @Test
    @SuppressWarnings("unchecked")
    void aBacklogOfPendingRevocationsIsWrittenInBoundedBatches() {
        org.mockito.Mockito.doThrow(new RedisConnectionFailureException("down"))
                .when(values).set(anyString(), anyString(), any(Duration.class));
        list.revoke("first", Instant.now().plusSeconds(600)); // opens the back-off
        for (int i = 0; i < 149; i++) {
            list.revoke("jti-" + i, Instant.now().plusSeconds(600));
        }
        assertEquals(150, list.pendingCount());

        org.mockito.Mockito.reset(values);
        clock.addAndGet(5_001);
        redisTtlIs(-2L);
        list.isRevoked("x");
        assertEquals(50, list.pendingCount(), "one request writes at most " + TokenRevocationList.MAX_FLUSH_PER_CALL);
        list.isRevoked("y");
        assertEquals(0, list.pendingCount());
        verify(values, times(150)).set(anyString(), eq("1"), any(Duration.class));
    }

    @Test
    void aRevocationAnnouncedByAnotherReplicaIsAppliedLocallyWithoutBeingRepublished() {
        long exp = Instant.now().plusSeconds(60).toEpochMilli();

        list.onRemoteRevocation("other-instance|" + exp + "|jti-remote");

        assertTrue(list.isRevoked("jti-remote"));
        verify(events).publishEvent(new TokenRevokedEvent("jti-remote"));
        verify(values, never()).set(anyString(), anyString(), any(Duration.class));
        verify(redis, never()).convertAndSend(anyString(), anyString());
    }

    @Test
    @SuppressWarnings("unchecked")
    void ownExpiredAndMalformedAnnouncementsAreIgnored() {
        redisTtlIs(-2L);
        long exp = Instant.now().plusSeconds(60).toEpochMilli();

        list.onRemoteRevocation(store.instanceId() + "|" + exp + "|jti-own");
        list.onRemoteRevocation("other|" + Instant.now().minusSeconds(1).toEpochMilli() + "|jti-old");
        list.onRemoteRevocation("garbage");
        list.onRemoteRevocation("other|not-a-number|jti");
        list.onRemoteRevocation("other|" + exp + "| ");
        list.onRemoteRevocation(null);

        verify(events, never()).publishEvent(any(Object.class));
        assertFalse(list.isRevoked("jti-own"));
        assertNull(store.parse(store.instanceId() + "|1|x"));
    }

    @Test
    void jtiKeysAreBounded() {
        assertEquals("revoked:abc", RedisTokenRevocationStore.key("abc"));
        assertTrue(RedisTokenRevocationStore.key("j".repeat(5_000)).length() < 100);
    }
}
