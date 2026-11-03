package com.example.taskflow.core.web;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The per-IP request rate limiter ({@link RateLimiterConfig}), bound from {@code app.rate-limit.*}.
 *
 * <ul>
 *   <li>{@code enabled} (default {@code false}; {@code true} in prod, needs Redis): read by the
 *       {@code @ConditionalOnProperty} that creates the filter at all.</li>
 *   <li>{@code max-requests-per-minute} (default 100): per client IP for the API.</li>
 *   <li>{@code auth-max-requests-per-minute} (default 20): per client IP for {@code /api/v1/auth/**}.</li>
 * </ul>
 *
 * <p>The per-account login throttle reads its own {@code app.rate-limit.login-*} keys in the auth
 * module ({@code LoginThrottleProperties}).
 */
@ConfigurationProperties(prefix = "app.rate-limit")
record RateLimitProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("100") int maxRequestsPerMinute,
        @DefaultValue("20") int authMaxRequestsPerMinute) {
}
