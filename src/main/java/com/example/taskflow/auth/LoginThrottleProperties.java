package com.example.taskflow.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The per-account login throttle ({@link LoginAttemptLimiter}), bound from the
 * {@code app.rate-limit.login-*} keys. The other {@code app.rate-limit.*} keys belong to the
 * per-IP request rate limiter in {@code core}.
 *
 * <ul>
 *   <li>{@code login-max-failures} (default 10; 0 or less disables the throttle): failed logins
 *       allowed per account within one window.</li>
 *   <li>{@code login-failure-window-seconds} (default 300): length of that window.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.rate-limit")
record LoginThrottleProperties(
        @DefaultValue("10") int loginMaxFailures,
        @DefaultValue("300") long loginFailureWindowSeconds) {
}
