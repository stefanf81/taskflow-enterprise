package com.example.taskflow.core.web;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Test-only access to the package-private rate limiter for the real-Redis suite in
 * {@code core.cache} ({@code AbstractRedisCacheLoadLockTest}).
 */
public final class RateLimiterTestAccess {

    private RateLimiterTestAccess() {
    }

    public static OncePerRequestFilter rateLimitFilter(int maxRequestsPerMinute, int authMaxRequestsPerMinute,
                                                       StringRedisTemplate redis) {
        return new RateLimiterConfig(maxRequestsPerMinute, authMaxRequestsPerMinute).createRateLimitFilter(redis);
    }
}
