package com.example.taskflow.auth;

import com.example.taskflow.core.FixedWindowCounter;
import com.example.taskflow.core.SharedStateStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
 * began in Redis restarts locally.
 */
@Component
class LoginAttemptLimiter {

    private final int maxFailures;
    private final long windowMillis;
    private final FixedWindowCounter failures;
    private final RedisLoginFailureCounter shared;

    public LoginAttemptLimiter(int maxFailures, long windowSeconds) {
        this(maxFailures, windowSeconds, (RedisLoginFailureCounter) null);
    }

    @Autowired
    public LoginAttemptLimiter(
            @Value("${app.rate-limit.login-max-failures:10}") int maxFailures,
            @Value("${app.rate-limit.login-failure-window-seconds:300}") long windowSeconds,
            ObjectProvider<RedisLoginFailureCounter> shared) {
        this(maxFailures, windowSeconds, shared.getIfAvailable());
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
                return;
            }
        }
        if (failures.current(key) >= maxFailures) {
            throw new TooManyLoginAttemptsException(failures.secondsUntilReset(key));
        }
    }

    public void recordFailure(String username) {
        if (maxFailures > 0) {
            String key = key(username);
            // Always counted locally too, so the fallback is warm if Redis fails mid-window.
            failures.increment(key);
            if (shared != null) {
                shared.increment(key, windowMillis);
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
