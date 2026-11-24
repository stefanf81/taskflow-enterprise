package com.example.taskflow.auth;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.taskflow.core.redis.RedisBackoff;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

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

    private void writesFail() {
        org.mockito.Mockito.doThrow(new RedisConnectionFailureException("down"))
                .when(redis)
                .execute(eq(RedisTokenRevocationStore.WRITE_SCRIPT), anyList(), any());
    }

    private void writesSucceed() {
        org.mockito.Mockito.doReturn(1L)
                .when(redis)
                .execute(eq(RedisTokenRevocationStore.WRITE_SCRIPT), anyList(), any());
    }

    /** The TTL (ms, as the script's argument) of the one denylist write for {@code jti}. */
    private long writtenTtlMillis(String jti) {
        ArgumentCaptor<Object> ttl = ArgumentCaptor.forClass(Object.class);
        verify(redis)
                .execute(
                        eq(RedisTokenRevocationStore.WRITE_SCRIPT),
                        eq(List.of("revoked:" + jti, RedisTokenRevocationStore.GENERATION_KEY)),
                        ttl.capture());
        return Long.parseLong((String) ttl.getValue());
    }

    @SuppressWarnings("unchecked")
    private void redisLookupFails() {
        when(redis.execute(any(RedisCallback.class))).thenThrow(new RedisConnectionFailureException("down"));
    }

    @Test
    void revokeWritesTheJtiWithTheTokensRemainingLifetimeAndAnnouncesIt() {
        list.revoke("jti-1", Instant.now().plusSeconds(600));

        // One script: the denylist entry and the revocation generation, atomically.
        long ttl = writtenTtlMillis("jti-1");
        assertTrue(ttl > 590_000 && ttl <= 600_000, String.valueOf(ttl));
        verify(redis).convertAndSend(eq(RedisTokenRevocationStore.CHANNEL), anyString());
        verify(events).publishEvent(new TokenRevokedEvent("jti-1"));
    }

    @Test
    void theKeyTtlHasAFloorSoAnAlmostExpiredTokenIsStillDenied() {
        list.revoke("jti-1", Instant.now().plusMillis(200));

        assertEquals(RedisTokenRevocationStore.MIN_TTL_MILLIS, writtenTtlMillis("jti-1"));
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
        writesFail();

        list.revoke("jti-1", Instant.now().plusSeconds(600));

        assertTrue(list.isRevoked("jti-1"), "denied locally right away");
        assertEquals(1, list.pendingCount());
        verify(events).publishEvent(new TokenRevokedEvent("jti-1"));
        verify(redis, never()).convertAndSend(anyString(), anyString());

        // Redis is back after the back-off.
        writesSucceed();
        org.mockito.Mockito.clearInvocations(redis);
        clock.addAndGet(5_001);
        redisTtlIs(-2L);
        assertFalse(list.isRevoked("jti-2"));

        writtenTtlMillis("jti-1");
        verify(redis).convertAndSend(eq(RedisTokenRevocationStore.CHANNEL), anyString());
        assertEquals(0, list.pendingCount());
    }

    @Test
    @SuppressWarnings("unchecked")
    void aBacklogOfPendingRevocationsIsWrittenInBoundedBatches() {
        writesFail();
        list.revoke("first", Instant.now().plusSeconds(600)); // opens the back-off
        for (int i = 0; i < 149; i++) {
            list.revoke("jti-" + i, Instant.now().plusSeconds(600));
        }
        assertEquals(150, list.pendingCount());

        writesSucceed();
        org.mockito.Mockito.clearInvocations(redis);
        clock.addAndGet(5_001);
        redisTtlIs(-2L);
        list.isRevoked("x");
        assertEquals(50, list.pendingCount(), "one request writes at most " + TokenRevocationList.MAX_FLUSH_PER_CALL);
        list.isRevoked("y");
        assertEquals(0, list.pendingCount());
        verify(redis, times(150)).execute(eq(RedisTokenRevocationStore.WRITE_SCRIPT), anyList(), any());
    }

    @Test
    void aRevocationAnnouncedByAnotherReplicaIsAppliedLocallyWithoutBeingRepublished() {
        long exp = Instant.now().plusSeconds(60).toEpochMilli();

        list.onRemoteRevocation("other-instance|" + exp + "|jti-remote");

        assertTrue(list.isRevoked("jti-remote"));
        verify(events).publishEvent(new TokenRevokedEvent("jti-remote"));
        verify(redis, never()).execute(eq(RedisTokenRevocationStore.WRITE_SCRIPT), anyList(), any());
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

    /** #218: stored revocations are written back to Redis (it may have lost them), without an announcement. */
    @Test
    @SuppressWarnings("unchecked")
    void restoreWritesStoredRevocationsBackToRedisInOnePipeline() {
        list.restore(java.util.List.of(
                new RevokedToken("jti-9", Instant.now().plusSeconds(600)),
                new RevokedToken("jti-10", Instant.now().plusSeconds(600))));

        verify(redis, times(1)).executePipelined(any(RedisCallback.class));
        verify(redis, never()).execute(eq(RedisTokenRevocationStore.WRITE_SCRIPT), anyList(), any());
        verify(redis, never()).convertAndSend(anyString(), anyString());
        verify(events, never()).publishEvent(any());
        assertTrue(list.isRevoked("jti-9"));
    }

    /** One round trip per batch: 1,200 revocations are three pipelines, not 1,200 commands. */
    @Test
    @SuppressWarnings("unchecked")
    void restoreBatchesLargeRestores() {
        java.util.List<RevokedToken> many = java.util.stream.IntStream.range(0, 1_200)
                .mapToObj(i -> new RevokedToken("jti-" + i, Instant.now().plusSeconds(600)))
                .toList();

        assertEquals(1_200, list.restore(many));

        verify(redis, times(3)).executePipelined(any(RedisCallback.class));
    }

    /** While Redis fails, restored revocations still deny on this replica through the local map. */
    @Test
    @SuppressWarnings("unchecked")
    void restoreStopsWritingToRedisAtTheFirstFailureButKeepsEveryEntryLocally() {
        org.mockito.Mockito.doThrow(new RedisConnectionFailureException("down"))
                .when(redis)
                .executePipelined(any(RedisCallback.class));
        java.util.List<RevokedToken> many = java.util.stream.IntStream.range(0, 1_200)
                .mapToObj(i -> new RevokedToken("j" + i, Instant.now().plusSeconds(600)))
                .toList();

        int applied = list.restore(many);

        assertEquals(1_200, applied);
        verify(redis, times(1)).executePipelined(any(RedisCallback.class));
        redisLookupFails();
        assertTrue(list.isRevoked("j0"));
        assertTrue(list.isRevoked("j1199"));
    }

    // ---- "not revoked" answers, cached under the revocation generation (BENCHMARKS.md §82) ----

    /** A clock the tests move by hand. */
    private static final class ManualClock extends java.time.Clock {
        long millis = 1_800_000_000_000L;

        @Override
        public java.time.ZoneId getZone() {
            return java.time.ZoneOffset.UTC;
        }

        @Override
        public java.time.Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return Instant.ofEpochMilli(millis);
        }
    }

    private final ManualClock tokenClock = new ManualClock();

    /** A list whose generation reads run on the calling thread, at the generation Redis holds. */
    private TokenRevocationList cachingList(String generation) {
        generationIs(generation);
        TokenRevocationList caching = new TokenRevocationList(events, store, tokenClock);
        caching.readGenerationWith(Runnable::run);
        return caching;
    }

    private void generationIs(String generation) {
        when(values.get(RedisTokenRevocationStore.GENERATION_KEY)).thenReturn(generation);
    }

    @SuppressWarnings("unchecked")
    private void verifyLookups(int count) {
        verify(redis, times(count)).execute(any(RedisCallback.class));
    }

    @Test
    void aNotRevokedAnswerIsReusedWhileTheGenerationIsUnchanged() {
        TokenRevocationList caching = cachingList("5");
        redisTtlIs(-2L);

        assertFalse(caching.isRevoked("jti-1"));
        tokenClock.millis += 400;
        assertFalse(caching.isRevoked("jti-1"));
        tokenClock.millis += 400; // a new read, the same generation
        assertFalse(caching.isRevoked("jti-1"));

        verifyLookups(1);
        verify(values, times(2)).get(RedisTokenRevocationStore.GENERATION_KEY);
    }

    /**
     * A revocation on another replica whose announcement never arrived: the next generation read
     * (at most {@link TokenRevocationList#GENERATION_READ_MILLIS} later) sees the new generation,
     * drops the cached answer, and the lookup finds the revocation.
     */
    @Test
    void anotherReplicasRevocationIsFoundAtTheNextGenerationReadEvenWithoutItsAnnouncement() {
        TokenRevocationList caching = cachingList("5");
        redisTtlIs(-2L);
        assertFalse(caching.isRevoked("jti-1"));

        generationIs("6");
        redisTtlIs(600_000L);
        tokenClock.millis += TokenRevocationList.GENERATION_READ_MILLIS;

        assertTrue(caching.isRevoked("jti-1"));
        assertEquals(0, caching.notRevokedCount());
    }

    @Test
    void anAnnouncedRevocationIsDeniedAtOnceDespiteACachedAnswer() {
        TokenRevocationList caching = cachingList("5");
        redisTtlIs(-2L);
        assertFalse(caching.isRevoked("jti-1"));

        caching.onRemoteRevocation(
                "other-replica|" + tokenClock.instant().plusSeconds(600).toEpochMilli() + "|jti-1");

        assertTrue(caching.isRevoked("jti-1"));
    }

    @Test
    void aRevocationOnThisReplicaIsDeniedAtOnceDespiteACachedAnswer() {
        TokenRevocationList caching = cachingList("5");
        redisTtlIs(-2L);
        writesSucceed();
        assertFalse(caching.isRevoked("jti-1"));

        caching.revoke("jti-1", tokenClock.instant().plusSeconds(600));

        assertTrue(caching.isRevoked("jti-1"));
    }

    @Test
    void withoutAFreshGenerationEveryRequestAsksRedis() {
        TokenRevocationList caching = cachingList("5");
        redisTtlIs(-2L);
        assertFalse(caching.isRevoked("jti-1"));
        caching.readGenerationWith(task -> {}); // reads stop arriving

        tokenClock.millis += TokenRevocationList.GENERATION_MAX_AGE_MILLIS + 1;
        assertFalse(caching.isRevoked("jti-1"));
        assertFalse(caching.isRevoked("jti-1"));

        verifyLookups(3);
    }

    @Test
    void aFailedGenerationReadDropsTheCachedAnswers() {
        TokenRevocationList caching = cachingList("5");
        redisTtlIs(-2L);
        assertFalse(caching.isRevoked("jti-1"));
        assertEquals(1, caching.notRevokedCount());

        when(values.get(RedisTokenRevocationStore.GENERATION_KEY))
                .thenThrow(new RedisConnectionFailureException("down"));
        tokenClock.millis += TokenRevocationList.GENERATION_READ_MILLIS;
        assertFalse(caching.isRevoked("jti-1"));

        assertEquals(0, caching.notRevokedCount());
        // The failure also opened the store's back-off: like any Redis outage, the request is then
        // answered from the local map only (fail open), without a lookup.
        verifyLookups(1);
    }

    @Test
    void anAnswerIsNotCachedWhenRedisCouldNotBeAsked() {
        TokenRevocationList caching = cachingList("5");
        redisLookupFails();

        assertFalse(caching.isRevoked("jti-1"), "fails open, as before");

        assertEquals(0, caching.notRevokedCount());
    }

    @Test
    void theGenerationIsReadAtMostOncePerInterval() {
        TokenRevocationList caching = cachingList("5");
        redisTtlIs(-2L);

        for (int i = 0; i < 50; i++) {
            caching.isRevoked("jti-" + i);
            tokenClock.millis += 5;
        }

        verify(values, times(1)).get(RedisTokenRevocationStore.GENERATION_KEY);
    }

    @Test
    void theGenerationIsBumpedTogetherWithEveryRestoredBatch() {
        // restore() writes through executePipelined: covered by the pipeline tests below; here the
        // read side: a generation that went back to 0 (Redis lost its data) is a change too.
        TokenRevocationList caching = cachingList("7");
        redisTtlIs(-2L);
        assertFalse(caching.isRevoked("jti-1"));

        generationIs(null);
        tokenClock.millis += TokenRevocationList.GENERATION_READ_MILLIS;
        caching.isRevoked("jti-2");

        assertEquals(1, caching.notRevokedCount(), "only the answer cached under generation 0");
    }
}
