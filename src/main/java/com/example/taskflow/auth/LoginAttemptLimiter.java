package com.example.taskflow.auth;

import com.example.taskflow.core.FixedWindowCounter;
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
        String account = username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
        return account + "|" + clientAddress();
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
