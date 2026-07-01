package com.example.todoapi.core;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;

@Configuration
@ConditionalOnProperty(name = "app.rate-limit.enabled", havingValue = "true", matchIfMissing = true)
public class RateLimiterConfig {

    private static final Logger log = LoggerFactory.getLogger(RateLimiterConfig.class);
    
    private static final int MAX_REQUESTS_PER_MINUTE = 100;
    private static final int AUTH_MAX_REQUESTS_PER_MINUTE = 5;

    @Bean
    public OncePerRequestFilter rateLimitFilter(StringRedisTemplate redisTemplate) {
        return new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(HttpServletRequest request,
                    HttpServletResponse response,
                    FilterChain filterChain) throws ServletException, IOException {

                String clientIp = getClientIp(request);
                String path = request.getRequestURI();
                boolean isAuthEndpoint = path.startsWith("/api/v1/auth/");
                
                int maxRequests = isAuthEndpoint ? AUTH_MAX_REQUESTS_PER_MINUTE : MAX_REQUESTS_PER_MINUTE;
                
                String redisKey = "rate_limit:" + clientIp + ":" + (isAuthEndpoint ? "auth" : "api");
                
                Long currentCount = redisTemplate.opsForValue().increment(redisKey);
                if (currentCount != null && currentCount == 1) {
                    redisTemplate.expire(redisKey, Duration.ofMinutes(1));
                }

                if (currentCount != null && currentCount > maxRequests) {
                    log.warn("Rate limit exceeded for IP {} on path {}", clientIp, path);
                    response.setStatus(429);
                    response.setHeader("Retry-After", "60");
                    response.setContentType("application/json");
                    response.getWriter().write("{\"error\":\"Too many requests. Please try again later.\"}");
                    return;
                }

                filterChain.doFilter(request, response);
            }

            private String getClientIp(HttpServletRequest request) {
                // Do not blindly trust X-Forwarded-For to prevent IP spoofing
                // In a production environment behind a trusted proxy, configure Spring to use ForwardedHeaderFilter
                // instead of manually parsing this header.
                return request.getRemoteAddr();
            }
        };
    }
}