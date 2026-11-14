package com.example.taskflow.auth;

import com.example.taskflow.core.FixedWindowCounter;
import com.example.taskflow.core.SharedStateStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Locale;

/**
 * Per-account throttle on <em>failed</em> logins.
 *
 * <p>The per-IP bucket in {@code RateLimiterConfig} stops a single address from
 * hammering the login endpoint, but a distributed guesser stays under it. This
 * adds a second, account-keyed limit: after {@code maxFailures} bad passwords
 * for one username inside the window, further attempts are rejected with 429
 * until the window ends. A successful login clears the account's count.
 *
 * <p>The counter is keyed on the username <em>and the client address</em>
 * ({@code getRemoteAddr()}, normalised by the trusted-proxy valve). Keying on the
 * username alone let anyone who knows an account name (e.g. the default
 * {@code admin}) keep its real owner locked out with a trickle of bad passwords;
 * now failures from one address only throttle that address for that account.
 * A distributed guesser is still limited per address by this and by the per-IP
 * auth bucket. {@code app.rate-limit.login-max-failures=0} disables the throttle.
 *
 * <p><b>Storage.</b> With {@code app.state.store=memory} (default) the count lives in a per-JVM
 * {@link FixedWindowCounter}. With {@code app.state.store=redis} (prod) it is a Redis fixed window
 * shared by all replicas ({@link RedisLoginFailureCounter}), so N replicas do not multiply the limit
 * by N. Failures are also counted locally, and while Redis is failing the local counter (same limits)
 * decides: during an outage the effective limit is therefore per replica again, and a window that
 * began in Redis restarts locally. Once Redis answers again it alone decides, except for one window
 * after the outage, in which the local counter is still enforced as well so failures it recorded
 * meanwhile are not forgiven by a Redis key that never saw them. Beyond that window the local copy
 * is ignored while Redis is healthy: another replica clears the shared window on a successful login
 * without this one hearing of it, and a stale local count would otherwise lock the account out
 * here while every other replica let it in.
 */
@Component
class LoginAttemptLimiter {

    private final int maxFailures;
    private final long windowMillis;
    private final FixedWindowCounter failures;
    private final RedisLoginFailureCounter shared;
    /**
     * While Redis is answering, the local counter is only a shadow copy of a window Redis owns, and
     * other replicas reset it there (a successful login) without this JVM ever hearing about it.
     * Enforcing it unconditionally therefore locked an account out on whichever replica happened to
     * hold stale failures, with Redis saying the account was fine. It is enforced alongside Redis
     * only until this instant: one window after the last time Redis could not answer, which is as
     * long as the local counter can hold failures Redis never saw.
     */
    private volatile long enforceLocalUntilMillis;

    public LoginAttemptLimiter(int maxFailures, long windowSeconds) {
        this(maxFailures, windowSeconds, (RedisLoginFailureCounter) null);
    }

    @Autowired
    public LoginAttemptLimiter(LoginThrottleProperties properties, ObjectProvider<RedisLoginFailureCounter> shared) {
        this(properties.loginMaxFailures(), properties.loginFailureWindowSeconds(), shared.getIfAvailable());
    }

    LoginAttemptLimiter(int maxFailures, long windowSeconds, RedisLoginFailureCounter shared) {
        this.maxFailures = maxFailures;
        this.windowMillis = Math.max(1, windowSeconds) * 1000;
        this.failures = new FixedWindowCounter(windowMillis, 10_000);
        this.shared = shared;
    }

    /** Throws {@link TooManyLoginAttemptsException} if the account is currently throttled. */
    public void checkAllowed(String username) {
        if (maxFailures <= 0) {
            return;
        }
        String key = key(username);
        if (shared != null) {
            long count = shared.current(key);
            if (count != RedisLoginFailureCounter.UNAVAILABLE) {
                if (count >= maxFailures) {
                    long retryAfter = shared.secondsUntilReset(key);
                    throw new TooManyLoginAttemptsException(retryAfter == RedisLoginFailureCounter.UNAVAILABLE
                            ? failures.secondsUntilReset(key)
                            : retryAfter);
                }
                // Redis is healthy and says the account is fine. The local copy only gets a say
                // while it may still hold failures from an outage Redis knows nothing about;
                // otherwise a count another replica has already cleared would lock this one out.
                if (localEnforced() && failures.current(key) >= maxFailures) {
                    throw new TooManyLoginAttemptsException(failures.secondsUntilReset(key));
                }
                return;
            }
            noteSharedOutage();
        }
        if (failures.current(key) >= maxFailures) {
            throw new TooManyLoginAttemptsException(failures.secondsUntilReset(key));
        }
    }

    private boolean localEnforced() {
        return System.currentTimeMillis() < enforceLocalUntilMillis;
    }

    /** Redis could not answer: its window may now be missing failures only this JVM counted. */
    private void noteSharedOutage() {
        enforceLocalUntilMillis = System.currentTimeMillis() + windowMillis;
    }

    public void recordFailure(String username) {
        if (maxFailures > 0) {
            String key = key(username);
            // Always counted locally too, so the fallback is warm if Redis fails mid-window.
            failures.increment(key);
            if (shared != null && shared.increment(key, windowMillis) == RedisLoginFailureCounter.UNAVAILABLE) {
                noteSharedOutage();
            }
        }
    }

    public void recordSuccess(String username) {
        if (maxFailures > 0) {
            String key = key(username);
            failures.reset(key);
            if (shared != null) {
                shared.reset(key);
            }
        }
    }

    private static String key(String username) {
        String account = username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
        // Usernames are user input: an oversized one is hashed so it cannot bloat the counter map.
        return SharedStateStore.boundedKeyPart(account) + "|" + clientAddress();
    }

    /** The current request's client address, or empty outside a request (unit tests). */
    private static String clientAddress() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            String address = attributes.getRequest().getRemoteAddr();
            return address == null ? "" : address;
        }
        return "";
    }
}
