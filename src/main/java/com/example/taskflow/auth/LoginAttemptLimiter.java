package com.example.taskflow.auth;

import com.example.taskflow.core.FixedWindowCounter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

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
 * <p>This is a temporary throttle, not a permanent lockout. It does let someone
 * who knows a username delay that account's owner for up to one window;
 * {@code app.rate-limit.login-max-failures} can be raised, or set to 0 to
 * disable the throttle, if that trade-off is wrong for a deployment.
 * State is per JVM, which matches the documented single-replica deployment.
 */
@Component
public class LoginAttemptLimiter {

    private final int maxFailures;
    private final FixedWindowCounter failures;

    public LoginAttemptLimiter(
            @Value("${app.rate-limit.login-max-failures:10}") int maxFailures,
            @Value("${app.rate-limit.login-failure-window-seconds:300}") long windowSeconds) {
        this.maxFailures = maxFailures;
        this.failures = new FixedWindowCounter(Math.max(1, windowSeconds) * 1000, 10_000);
    }

    /** Throws {@link TooManyLoginAttemptsException} if the account is currently throttled. */
    public void checkAllowed(String username) {
        if (maxFailures <= 0) {
            return;
        }
        String key = key(username);
        if (failures.current(key) >= maxFailures) {
            throw new TooManyLoginAttemptsException(failures.secondsUntilReset(key));
        }
    }

    public void recordFailure(String username) {
        if (maxFailures > 0) {
            failures.increment(key(username));
        }
    }

    public void recordSuccess(String username) {
        if (maxFailures > 0) {
            failures.reset(key(username));
        }
    }

    private static String key(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }
}
