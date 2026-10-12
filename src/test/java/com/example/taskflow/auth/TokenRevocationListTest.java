package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class TokenRevocationListTest {

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

        org.mockito.Mockito.verify(events).publishEvent(new com.example.taskflow.core.TokenRevokedEvent("jti-1"));
        org.mockito.Mockito.verifyNoMoreInteractions(events);
    }
}
