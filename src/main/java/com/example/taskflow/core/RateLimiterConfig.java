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

    /** How long to skip Redis after it failed, so an outage costs one timeout, not one per request. */
    private static final long REDIS_BACKOFF_MILLIS = 5_000;
    private static final long WINDOW_MILLIS = 60_000;

    private final int maxRequestsPerMinute;
    private final int authMaxRequestsPerMinute;

    /**
     * Per-JVM fallback used while Redis is failing. Keys are the same
     * {@code rate_limit:<ip>:<kind>} strings, so both paths enforce the same
     * limits. Bounded so an attacker rotating source addresses cannot grow it.
     */
    private final FixedWindowCounter localFallback = new FixedWindowCounter(WINDOW_MILLIS, 50_000);
    private volatile long redisBackoffUntilMillis;

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
                String path = requestPath(request);
                // Skip health/liveness/readiness probes so K8s/deployment checks
                // don't burn rate-limit budget.
                return path.startsWith("/actuator/health");
            }

            @Override
            protected void doFilterInternal(HttpServletRequest request,
                    HttpServletResponse response,
                    FilterChain filterChain) throws ServletException, IOException {

                String clientIp = getClientIp(request);
                String path = requestPath(request);
                boolean isAuthEndpoint = path.startsWith("/api/v1/auth/");

                int maxRequests = isAuthEndpoint ? authMaxRequestsPerMinute : maxRequestsPerMinute;

                String redisKey = "rate_limit:" + clientIp + ":" + (isAuthEndpoint ? "auth" : "api");

                long currentCount = countRequest(redisTemplate, redisKey);
                if (currentCount > maxRequests) {
                    String safePath = LogSanitizer.stripNewlines(path);
                    String safeIp = LogSanitizer.stripNewlines(clientIp);
                    log.warn("Rate limit exceeded for IP {} on path {}", safeIp, safePath);
                    response.setStatus(429);
                    response.setHeader("Retry-After", "60");
                    response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"error\":\"Too many requests. Please try again later.\"}");
                    return;
                }

                filterChain.doFilter(request, response);
            }

            /**
             * Tomcat's RemoteIpValve (configured via
             * {@code server.forward-headers-strategy=native} in prod
             * properties) normalizes the request so that {@code getRemoteAddr()}
             * returns the real client IP from the {@code X-Forwarded-For}
             * header set by the trusted Nginx reverse proxy. The
             * RemoteIpValve runs at the servlet container boundary, so it
             * executes before this custom filter — no manual header
             * parsing is needed here.
             */
            private String getClientIp(HttpServletRequest request) {
                return request.getRemoteAddr();
            }
        };
    }

    /**
     * Counts this request against the shared Redis bucket. If Redis is failing
     * (or was within the last {@link #REDIS_BACKOFF_MILLIS}), the per-JVM
     * fallback counter is used instead, so limits — in particular the strict
     * auth bucket that protects BCrypt — keep applying during a Redis outage
     * rather than silently disappearing.
     */
    private long countRequest(StringRedisTemplate redisTemplate, String redisKey) {
        if (System.currentTimeMillis() >= redisBackoffUntilMillis) {
            try {
                Long count = redisTemplate.execute(
                        RATE_LIMIT_SCRIPT,
                        Collections.singletonList(redisKey),
                        String.valueOf(WINDOW_MILLIS));
                if (count != null) {
                    return count;
                }
            } catch (Exception e) {
                redisBackoffUntilMillis = System.currentTimeMillis() + REDIS_BACKOFF_MILLIS;
                log.warn("Rate limiter Redis error; using in-memory fallback for {} ms: {}",
                        REDIS_BACKOFF_MILLIS, LogSanitizer.safeMessage(e));
            }
        }
        return localFallback.increment(redisKey);
    }

    /**
     * The path used to pick a bucket. Built from the container-decoded servlet
     * path rather than {@code getRequestURI()}, which is the raw request line:
     * {@code /api/v1/%61uth/login} reaches the login handler (the container
     * decodes it) but would not match a raw {@code startsWith("/api/v1/auth/")}
     * and so would be billed to the looser API bucket.
     */
    static String requestPath(HttpServletRequest request) {
        String servletPath = request.getServletPath();
        String pathInfo = request.getPathInfo();
        String path = (servletPath == null ? "" : servletPath) + (pathInfo == null ? "" : pathInfo);
        if (path.isEmpty()) {
            path = request.getRequestURI();
        }
        return path == null ? "" : path;
    }
}
