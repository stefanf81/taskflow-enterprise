package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.*;

class TokenRevocationListTest {

    @Test
    void expiriesAreJudgedByTheInjectedTokenClock() {
        Instant now = Instant.parse("2026-10-12T08:00:00Z");
        TokenRevocationList list = new TokenRevocationList(null, null, Clock.fixed(now, ZoneOffset.UTC));

        list.revoke("current", now.plusSeconds(60));
        list.revoke("expired", now.minusSeconds(1));

        assertTrue(list.isRevoked("current"));
        assertFalse(list.isRevoked("expired"), "already expired by the token clock: nothing to deny");
    }

    @Test
    void revokedTokenIsDeniedUntilItsOwnExpiry() {
        TokenRevocationList list = new TokenRevocationList();
        list.revoke("jti-1", Instant.now().plusSeconds(60));

        assertTrue(list.isRevoked("jti-1"));
        assertFalse(list.isRevoked("jti-2"));
    }

    @Test
    void alreadyExpiredTokensAreNotStored() {
        TokenRevocationList list = new TokenRevocationList();
        list.revoke("old", Instant.now().minusSeconds(1));

        assertFalse(list.isRevoked("old"));
    }

    @Test
    void ignoresMissingIdsAndExpiries() {
        TokenRevocationList list = new TokenRevocationList();

        assertDoesNotThrow(() -> list.revoke(null, Instant.now().plusSeconds(60)));
        assertDoesNotThrow(() -> list.revoke("  ", Instant.now().plusSeconds(60)));
        assertDoesNotThrow(() -> list.revoke("no-expiry", null));
        assertFalse(list.isRevoked(null));
        assertFalse(list.isRevoked("no-expiry"));
    }

    @Test
    void expiredEntriesAreDroppedOnLaterRevocations() throws Exception {
        TokenRevocationList list = new TokenRevocationList();
        list.revoke("short", Instant.now().plusMillis(30));
        Thread.sleep(60);

        assertFalse(list.isRevoked("short"), "expired entries no longer deny");
        list.revoke("next", Instant.now().plusSeconds(60));
        assertTrue(list.isRevoked("next"));
    }

    @Test
    void revocationIsPublishedSoLongLivedStreamsCanCloseImmediately() {
        var events = org.mockito.Mockito.mock(org.springframework.context.ApplicationEventPublisher.class);
        TokenRevocationList list = new TokenRevocationList(events);

        list.revoke("jti-1", Instant.now().plusSeconds(60));
        list.revoke("expired", Instant.now().minusSeconds(1));

        org.mockito.Mockito.verify(events).publishEvent(new com.example.taskflow.auth.TokenRevokedEvent("jti-1"));
        org.mockito.Mockito.verifyNoMoreInteractions(events);
    }

    /** #218: every revocation also goes to the durable copy; a failing copy does not fail the logout. */
    @Test
    void revocationsAreAlsoStoredDurably() {
        PersistentTokenRevocations persistent = org.mockito.Mockito.mock(PersistentTokenRevocations.class);
        Instant now = Instant.parse("2026-10-12T08:00:00Z");
        TokenRevocationList list = new TokenRevocationList(null, null, persistent, Clock.fixed(now, ZoneOffset.UTC));

        list.revoke("jti-1", now.plusSeconds(60));
        list.revoke("expired", now.minusSeconds(1));

        org.mockito.Mockito.verify(persistent).save("jti-1", now.plusSeconds(60));
        org.mockito.Mockito.verifyNoMoreInteractions(persistent);
    }

    /** #218: a restarted replica (empty map) denies the stored revocations again, expired ones skipped. */
    @Test
    void restoredRevocationsAreDeniedAgain() {
        Instant now = Instant.parse("2026-10-12T08:00:00Z");
        TokenRevocationList list = new TokenRevocationList(null, null, Clock.fixed(now, ZoneOffset.UTC));

        int applied = list.restore(java.util.List.of(
                new RevokedToken("live", now.plusSeconds(300)),
                new RevokedToken("dead", now.minusSeconds(1))));

        assertEquals(1, applied);
        assertTrue(list.isRevoked("live"));
        assertFalse(list.isRevoked("dead"));
    }
}
