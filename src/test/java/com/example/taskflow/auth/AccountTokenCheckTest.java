package com.example.taskflow.auth;

import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.testsupport.MutableTestClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** https://github.com/stefanf81/taskflow-enterprise/issues/218: tokens follow their account. */
class AccountTokenCheckTest {

    private static final Instant NOW = Instant.parse("2026-11-04T10:00:00Z");

    private final UserRepository users = mock(UserRepository.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final MutableTestClock clock = new MutableTestClock(NOW);
    private AccountTokenCheck check;

    @BeforeEach
    void setUp() {
        check = new AccountTokenCheck(users, events, clock);
    }

    private void account(String email, int version, String role) {
        when(users.findTokenState(email)).thenReturn(Optional.of(state(version, role)));
    }

    private static UserRepository.TokenState state(int version, String role) {
        return new UserRepository.TokenState() {
            @Override public int getTokenVersion() { return version; }
            @Override public String getRole() { return role; }
        };
    }

    private static Jwt token(String subject, String scope, Integer version) {
        Jwt.Builder builder = Jwt.withTokenValue("t").header("alg", "RS256")
                .subject(subject).claim("scope", scope).issuedAt(NOW).expiresAt(NOW.plusSeconds(3600));
        if (version != null) {
            builder.claim(AccountTokenCheck.VERSION_CLAIM, version);
        }
        return builder.build();
    }

    @Test
    void aTokenOfTheCurrentVersionAndRoleIsAccepted() {
        account("jane@x.test", 2, "ROLE_CUSTOMER");

        assertFalse(check.validate(token("jane@x.test", "ROLE_CUSTOMER FACTOR_PASSWORD", 2)).hasErrors());
    }

    @Test
    void aTokenOfAnOlderVersionIsRejected() {
        account("jane@x.test", 3, "ROLE_CUSTOMER");

        assertTrue(check.validate(token("jane@x.test", "ROLE_CUSTOMER", 2)).hasErrors());
    }

    /** Tokens issued before V39 carry no version claim: they count as the column's default, 0. */
    @Test
    void aTokenWithoutTheClaimIsVersionZero() {
        account("jane@x.test", 0, "ROLE_CUSTOMER");
        assertFalse(check.validate(token("jane@x.test", "ROLE_CUSTOMER", null)).hasErrors());

        account("joe@x.test", 1, "ROLE_CUSTOMER");
        assertTrue(check.validate(token("joe@x.test", "ROLE_CUSTOMER", null)).hasErrors());
    }

    @Test
    void aDemotedAccountsAdminTokenIsRejected() {
        account("former@x.test", 0, "ROLE_CUSTOMER");

        assertTrue(check.validate(token("former@x.test", "ROLE_ADMIN FACTOR_PASSWORD", 0)).hasErrors());
    }

    @Test
    void aDeletedAccountsTokenIsRejected() {
        when(users.findTokenState("gone@x.test")).thenReturn(Optional.empty());

        assertTrue(check.validate(token("gone@x.test", "ROLE_CUSTOMER", 0)).hasErrors());
    }

    @Test
    void theAccountIsReadOncePerIntervalAndCaseInsensitively() {
        account("jane@x.test", 0, "ROLE_CUSTOMER");

        check.validate(token("jane@x.test", "ROLE_CUSTOMER", 0));
        check.validate(token("JANE@x.test", "ROLE_CUSTOMER", 0));
        verify(users, times(1)).findTokenState(any());

        clock.advance(AccountTokenCheck.CACHE_TTL.plus(Duration.ofMillis(1)));
        check.validate(token("jane@x.test", "ROLE_CUSTOMER", 0));
        verify(users, times(2)).findTokenState(any());
    }

    @Test
    void revokingAllTokensAppliesAtOnceOnThisReplicaAndTellsTheStreams() {
        account("jane@x.test", 0, "ROLE_CUSTOMER");
        Jwt before = token("jane@x.test", "ROLE_CUSTOMER", 0);
        assertFalse(check.validate(before).hasErrors());

        when(users.incrementTokenVersion("jane@x.test")).thenReturn(1);
        account("jane@x.test", 1, "ROLE_CUSTOMER");
        check.revokeAllTokens("jane@x.test");

        assertTrue(check.validate(before).hasErrors(), "no wait for the cache interval");
        assertFalse(check.validate(token("jane@x.test", "ROLE_CUSTOMER", 1)).hasErrors());
        assertEquals(1, check.tokenVersion("jane@x.test"), "a new login gets the new version");
        verify(events).publishEvent(new AccountTokensRevokedEvent("jane@x.test"));
    }

    @Test
    void revokingAnUnknownAccountDoesNothing() {
        when(users.incrementTokenVersion("nobody@x.test")).thenReturn(0);

        check.revokeAllTokens("nobody@x.test");

        verify(events, never()).publishEvent(any());
    }

    /** A database outage must not sign every user out (fail open, like the Redis denylist). */
    @Test
    void aDatabaseFailureFallsBackToTheLastKnownStateOrAccepts() {
        when(users.findTokenState("new@x.test")).thenThrow(new DataAccessResourceFailureException("down"));
        assertFalse(check.validate(token("new@x.test", "ROLE_CUSTOMER", 0)).hasErrors());

        account("jane@x.test", 4, "ROLE_CUSTOMER");
        check.validate(token("jane@x.test", "ROLE_CUSTOMER", 4));
        clock.advance(AccountTokenCheck.CACHE_TTL.plusSeconds(1));
        when(users.findTokenState("jane@x.test")).thenThrow(new DataAccessResourceFailureException("down"));
        assertTrue(check.validate(token("jane@x.test", "ROLE_CUSTOMER", 3)).hasErrors(),
                "the stale state still rejects a revoked version");
        assertFalse(check.validate(token("jane@x.test", "ROLE_CUSTOMER", 4)).hasErrors());
    }

    @Test
    void aTokenWithoutSubjectIsRejected() {
        Jwt anonymous = Jwt.withTokenValue("t").header("alg", "RS256").claim("scope", "ROLE_ADMIN").build();

        assertTrue(check.validate(anonymous).hasErrors());
    }
}
