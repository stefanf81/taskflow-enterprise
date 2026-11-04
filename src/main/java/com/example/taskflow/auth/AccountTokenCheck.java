package com.example.taskflow.auth;

import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.transaction.TransactionException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Ties every access token to the current state of its account
 * (https://github.com/stefanf81/taskflow-enterprise/issues/218).
 *
 * <p>A token is rejected when its account no longer exists, when the account's role is not one of
 * the token's authorities (demoted), or when its {@value #VERSION_CLAIM} claim is not the account's
 * current {@code token_version}. {@link #revokeAllTokens} raises that version, which revokes every
 * token of the account at once without knowing their ids. Tokens issued before V39 have no claim and
 * count as version 0, the column's default.
 *
 * <p>The account state is cached per JVM for {@link #CACHE_TTL}, so the check costs one indexed query
 * per account and interval rather than one per request. A change made through
 * {@link #revokeAllTokens} applies at once on this replica; a change made elsewhere (another replica,
 * or straight in the database) applies within that interval.
 *
 * <p>A database failure does not reject tokens: the last cached state is used, or the token is
 * accepted when there is none, like the Redis-backed denylist (ADR-018). Rejecting would sign every
 * user out during a brief outage, and with the database down the requests fail anyway.
 */
@Component
class AccountTokenCheck {

    private static final Logger logger = LoggerFactory.getLogger(AccountTokenCheck.class);

    /** The access-token claim carrying the account's token version. */
    static final String VERSION_CLAIM = "tv";
    static final Duration CACHE_TTL = Duration.ofSeconds(10);
    static final int MAX_CACHED = 10_000;
    private static final Duration WARN_INTERVAL = Duration.ofSeconds(30);

    /** What a token is checked against. */
    record AccountState(int tokenVersion, String role) {
    }

    /** {@code state} empty: no such account. */
    private record Cached(Optional<AccountState> state, Instant loadedAt) {
    }

    private final UserRepository users;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();
    private final AtomicReference<Instant> lastWarning = new AtomicReference<>(Instant.EPOCH);

    @Autowired
    AccountTokenCheck(UserRepository users, ApplicationEventPublisher events) {
        this(users, events, TokenProvider.TOKEN_CLOCK);
    }

    AccountTokenCheck(UserRepository users, ApplicationEventPublisher events, Clock clock) {
        this.users = users;
        this.events = events;
        this.clock = clock;
    }

    /** The version a new token of this account carries (0 for an unknown account). */
    int tokenVersion(String username) {
        return current(username).map(AccountState::tokenVersion).orElse(0);
    }

    /** Validator of the JWT decoder; see the class comment. */
    OAuth2TokenValidatorResult validate(Jwt jwt) {
        String username = jwt.getSubject();
        if (username == null || username.isBlank()) {
            return failure("The token names no account.");
        }
        Optional<AccountState> state;
        try {
            state = current(username);
        } catch (DataAccessException | TransactionException e) {
            Cached stale = cache.get(key(username));
            if (stale == null) {
                warnRateLimited(e);
                return OAuth2TokenValidatorResult.success();
            }
            state = stale.state();
        }
        if (state.isEmpty()) {
            return failure("The account no longer exists.");
        }
        if (versionOf(jwt) != state.get().tokenVersion()) {
            return failure("The token has been revoked.");
        }
        if (!hasAuthority(jwt, state.get().role())) {
            return failure("The account's role has changed.");
        }
        return OAuth2TokenValidatorResult.success();
    }

    /**
     * Revokes every access token of the account: raises its token version (committed by this call
     * unless the caller's transaction is active), forgets the cached state and publishes
     * {@link AccountTokensRevokedEvent}. Unknown accounts are ignored.
     */
    void revokeAllTokens(String username) {
        if (users.incrementTokenVersion(username) == 0) {
            return;
        }
        cache.remove(key(username));
        events.publishEvent(new AccountTokensRevokedEvent(username));
    }

    /** Drops the cached state, so the next check reads the account again (a change made in the database). */
    void forget(String username) {
        cache.remove(key(username));
    }

    private Optional<AccountState> current(String username) {
        String key = key(username);
        Instant now = Instant.now(clock);
        Cached cached = cache.get(key);
        if (cached != null && now.isBefore(cached.loadedAt().plus(CACHE_TTL))) {
            return cached.state();
        }
        Optional<AccountState> state = users.findTokenState(username)
                .map(row -> new AccountState(row.getTokenVersion(), row.getRole()));
        if (cache.size() >= MAX_CACHED) {
            cache.values().removeIf(entry -> !now.isBefore(entry.loadedAt().plus(CACHE_TTL)));
            if (cache.size() >= MAX_CACHED) {
                cache.clear();
            }
        }
        cache.put(key, new Cached(state, now));
        return state;
    }

    private static int versionOf(Jwt jwt) {
        Object claim = jwt.getClaims().get(VERSION_CLAIM);
        return claim instanceof Number number ? number.intValue() : 0;
    }

    private static boolean hasAuthority(Jwt jwt, String role) {
        String scope = jwt.getClaimAsString("scope");
        return role != null && scope != null && Arrays.asList(scope.split(" ")).contains(role);
    }

    private static String key(String username) {
        return username.trim().toLowerCase(Locale.ROOT);
    }

    private static OAuth2TokenValidatorResult failure(String description) {
        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", description, null));
    }

    private void warnRateLimited(RuntimeException e) {
        Instant now = Instant.now(clock);
        Instant last = lastWarning.get();
        if (now.isAfter(last.plus(WARN_INTERVAL)) && lastWarning.compareAndSet(last, now)) {
            logger.warn("Account token check skipped, the account could not be read: {}",
                    LogSanitizer.safeMessage(e));
        }
    }
}
