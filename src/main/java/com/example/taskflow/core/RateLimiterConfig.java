package com.example.taskflow.core;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.Ordered;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

@Configuration
@ConditionalOnProperty(name = "app.rate-limit.enabled", havingValue = "true", matchIfMissing = false)
public class RateLimiterConfig {

    private static final Logger log = LoggerFactory.getLogger(RateLimiterConfig.class);

    /**
     * Atomic INCR + PEXPIRE via Lua. Two-command INCR then EXPIRE leaks a key
     * without TTL if the process crashes between commands → permanent block.
     * Lua runs atomically on Redis's single thread; EVAL is the production
     * pattern per spring-boot-best-practice / jhipster.
     */
    private static final DefaultRedisScript<Long> RATE_LIMIT_SCRIPT;

    static {
        // KEYS[1]=rate_limit:ip:kind  ARGV[1]=ttlMillis (60000)
        String lua = "local c = redis.call('incr', KEYS[1]); "
                + "if c == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end; "
                + "return c";
        RATE_LIMIT_SCRIPT = new DefaultRedisScript<>();
        RATE_LIMIT_SCRIPT.setScriptText(lua);
        RATE_LIMIT_SCRIPT.setResultType(Long.class);
    }

    private final int maxRequestsPerMinute;
    private final int authMaxRequestsPerMinute;

    public RateLimiterConfig(
            @Value("${app.rate-limit.max-requests-per-minute:100}") int maxRequestsPerMinute,
            @Value("${app.rate-limit.auth-max-requests-per-minute:20}") int authMaxRequestsPerMinute) {
        this.maxRequestsPerMinute = maxRequestsPerMinute;
        this.authMaxRequestsPerMinute = authMaxRequestsPerMinute;
    }

    @Bean
    public FilterRegistrationBean<OncePerRequestFilter> rateLimitFilter(StringRedisTemplate redisTemplate) {
        FilterRegistrationBean<OncePerRequestFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(createRateLimitFilter(redisTemplate));
        // Tomcat has already normalized trusted proxy headers before servlet filters
        // run. Rate-limit before Spring Security reaches JWT verification or BCrypt.
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 20);
        registration.addUrlPatterns("/*");
        return registration;
    }

    OncePerRequestFilter createRateLimitFilter(StringRedisTemplate redisTemplate) {
        return new OncePerRequestFilter() {
            @Override
            protected boolean shouldNotFilter(HttpServletRequest request) {
                String path = request.getRequestURI();
                // Skip health/liveness/readiness probes so K8s/deployment checks
                // don't burn rate-limit budget.
                return path != null && (path.startsWith("/actuator/health")
                        || path.equals("/actuator/health/liveness")
                        || path.equals("/actuator/health/readiness"));
            }

            @Override
            protected void doFilterInternal(HttpServletRequest request,
                    HttpServletResponse response,
                    FilterChain filterChain) throws ServletException, IOException {

                String clientIp = getClientIp(request);
                String path = request.getRequestURI();
                if (path == null) {
                    path = "";
                }
                boolean isAuthEndpoint = path.startsWith("/api/v1/auth/");

                int maxRequests = isAuthEndpoint ? authMaxRequestsPerMinute : maxRequestsPerMinute;

                String redisKey = "rate_limit:" + clientIp + ":" + (isAuthEndpoint ? "auth" : "api");

                try {
                    Long currentCount = redisTemplate.execute(
                            RATE_LIMIT_SCRIPT,
                            Collections.singletonList(redisKey),
                            "60000");

                    if (currentCount != null && currentCount > maxRequests) {
                        String safePath = path.replaceAll("[\\r\\n]", "");
                        log.warn("Rate limit exceeded for IP {} on path {}", clientIp, safePath);
                        response.setStatus(429);
                        response.setHeader("Retry-After", "60");
                        response.setContentType("application/json;charset=UTF-8");
                        response.getWriter().write("{\"error\":\"Too many requests. Please try again later.\"}");
                        return;
                    }
                } catch (Exception e) {
                    log.warn("Rate limiter failed open due to Redis error: {}", LogSanitizer.safeMessage(e));
                }

                filterChain.doFilter(request, response);
            }

            /**
             * H2: Spring Boot's ForwardedHeaderFilter (registered via
             * {@code server.forward-headers-strategy=framework} in prod
             * properties) wraps the request so that {@code getRemoteAddr()}
             * returns the real client IP from the {@code X-Forwarded-For}
             * header set by the trusted Nginx reverse proxy. The
             * ForwardedHeaderFilter runs at highest precedence, so it
             * executes before this custom filter — no manual header
             * parsing is needed here.
             */
            private String getClientIp(HttpServletRequest request) {
                return request.getRemoteAddr();
            }
        };
    }
}
