package com.example.taskflow.core.web;
import com.example.taskflow.core.FixedWindowCounter;
import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.core.redis.RedisBackoff;
import com.example.taskflow.core.redis.RedisConnectionRecovery;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.Ordered;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.List;

@Configuration
@ConditionalOnProperty(name = "app.rate-limit.enabled", havingValue = "true", matchIfMissing = false)
@EnableConfigurationProperties(RateLimitProperties.class)
class RateLimiterConfig {

    private static final Logger log = LoggerFactory.getLogger(RateLimiterConfig.class);

    /**
     * Atomic INCR + PEXPIRE via Lua. Two-command INCR then EXPIRE leaks a key
     * without TTL if the process crashes between commands → permanent block.
     * Lua runs atomically on Redis's single thread; EVAL is the production
     * pattern per spring-boot-best-practice / jhipster. Returns
     * {@code {count, remaining window in ms}}; the remaining time becomes
     * {@code Retry-After}. A key without a TTL (PTTL -1) gets one, so it can
     * never become a permanent block either.
     */
    @SuppressWarnings({"rawtypes", "unchecked"})
    private static final DefaultRedisScript<List<Long>> RATE_LIMIT_SCRIPT = new DefaultRedisScript<>(
            // KEYS[1]=rate_limit:ip:kind  ARGV[1]=ttlMillis (60000)
            "local c = redis.call('incr', KEYS[1]); "
                    + "local t = redis.call('pttl', KEYS[1]); "
                    + "if t < 0 then redis.call('pexpire', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end; "
                    + "return {c, t}",
            (Class) List.class);

    /** A request's count in its window and the seconds until that window ends (at least 1). */
    record Count(long count, long retryAfterSeconds) {
    }

    private static final long WINDOW_MILLIS = 60_000;

    private final int maxRequestsPerMinute;
    private final int authMaxRequestsPerMinute;

    /**
     * Per-JVM fallback used while Redis is failing. Keys are the same
     * {@code rate_limit:<ip>:<kind>} strings, so both paths enforce the same
     * limits. Bounded so an attacker rotating source addresses cannot grow it.
     *
     * <p>Per JVM by definition: it exists for the case where the shared Redis
     * bucket cannot be reached. With N replicas behind a load balancer, the
     * effective limit during a Redis outage is therefore up to N × the configured
     * limit per client (each replica counts only the requests it received);
     * while Redis answers, the one shared bucket applies to the whole deployment.
     */
    private final FixedWindowCounter localFallback = new FixedWindowCounter(WINDOW_MILLIS, 50_000);
    /** Skips Redis after it failed, so an outage costs one timeout per interval, not one per request. */
    private final RedisBackoff redisBackoff;

    @Autowired
    public RateLimiterConfig(RateLimitProperties properties,
                             ObjectProvider<RedisConnectionRecovery> connectionRecovery) {
        this.maxRequestsPerMinute = properties.maxRequestsPerMinute();
        this.authMaxRequestsPerMinute = properties.authMaxRequestsPerMinute();
        this.redisBackoff = new RedisBackoff("Rate limiter", connectionRecovery.getIfAvailable());
    }

    RateLimiterConfig(int maxRequestsPerMinute, int authMaxRequestsPerMinute) {
        this.maxRequestsPerMinute = maxRequestsPerMinute;
        this.authMaxRequestsPerMinute = authMaxRequestsPerMinute;
        this.redisBackoff = new RedisBackoff("Rate limiter");
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
                // don't burn rate-limit budget, and CORS preflights: answered by the
                // CORS filter without reaching a handler, they only cost a Redis call.
                return path.startsWith("/actuator/health") || "OPTIONS".equals(request.getMethod());
            }

            @Override
            protected void doFilterInternal(HttpServletRequest request,
                    HttpServletResponse response,
                    FilterChain filterChain) throws ServletException, IOException {

                String clientIp = getClientIp(request);
                String path = requestPath(request);
                boolean isAuthEndpoint = isAuthBucket(request.getMethod(), path);

                int maxRequests = isAuthEndpoint ? authMaxRequestsPerMinute : maxRequestsPerMinute;

                String redisKey = "rate_limit:" + clientIp + ":" + (isAuthEndpoint ? "auth" : "api");

                Count counted = countRequest(redisTemplate, redisKey);
                long currentCount = counted.count();
                if (currentCount > maxRequests) {
                    // Logged once per client, bucket and window: the counter passes the limit exactly
                    // once, and a line per rejected request let one client write ~1 MB/s of log.
                    if (currentCount == maxRequests + 1L) {
                        String safePath = LogSanitizer.stripNewlines(path);
                        String safeIp = LogSanitizer.stripNewlines(clientIp);
                        log.warn("Rate limit exceeded for IP {} on path {}; further requests in this window "
                                + "are rejected without logging", safeIp, safePath);
                    }
                    response.setStatus(429);
                    response.setHeader("Retry-After", String.valueOf(counted.retryAfterSeconds()));
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
     * (or was within the last {@link RedisBackoff#DEFAULT_BACKOFF_MILLIS}), the per-JVM
     * fallback counter is used instead, so limits — in particular the strict
     * auth bucket that protects BCrypt — keep applying during a Redis outage
     * rather than silently disappearing. {@code Retry-After} comes from the
     * window that counted the request.
     */
    private Count countRequest(StringRedisTemplate redisTemplate, String redisKey) {
        if (redisBackoff.allowRequest()) {
            try {
                List<Long> result = redisTemplate.execute(
                        RATE_LIMIT_SCRIPT,
                        Collections.singletonList(redisKey),
                        String.valueOf(WINDOW_MILLIS));
                redisBackoff.recordSuccess();
                if (result != null && result.size() == 2 && result.get(0) != null && result.get(1) != null) {
                    return new Count(result.get(0), retryAfterSeconds(result.get(1)));
                }
            } catch (RuntimeException e) {
                redisBackoff.recordFailure(e);
            }
        }
        long count = localFallback.increment(redisKey);
        return new Count(count, localFallback.secondsUntilReset(redisKey));
    }

    /** Remaining window in ms → whole seconds, rounded up, at least 1, at most the window. */
    static long retryAfterSeconds(long remainingMillis) {
        long millis = remainingMillis <= 0 ? WINDOW_MILLIS : Math.min(remainingMillis, WINDOW_MILLIS);
        return Math.max(1, (millis + 999) / 1000);
    }

    /**
     * Whether a request is billed to the strict auth bucket: the state-changing calls under
     * {@code /api/v1/auth/} (login, register, refresh, logout), which cost a BCrypt check or a
     * database write. The read-only {@code GET}/{@code HEAD} ones ({@code /csrf}, {@code /me}) only
     * verify a token and go to the API bucket: every page load of the web app fetches the CSRF
     * token, so in the auth bucket ten page loads a minute from one shared address (shop Wi-Fi,
     * an office or carrier NAT) refused logins for everyone behind it.
     */
    static boolean isAuthBucket(String method, String path) {
        return path.startsWith("/api/v1/auth/") && !"GET".equals(method) && !"HEAD".equals(method);
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
