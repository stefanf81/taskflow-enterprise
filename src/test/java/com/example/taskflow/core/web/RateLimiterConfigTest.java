package com.example.taskflow.core.web;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RateLimiterConfigTest {

    private RateLimiterConfig rateLimiterConfig;
    private StringRedisTemplate redisTemplate;
    private OncePerRequestFilter filter;

    @BeforeEach
    void setUp() {
        rateLimiterConfig = new RateLimiterConfig(100, 20);
        redisTemplate = mock(StringRedisTemplate.class);
        filter = rateLimiterConfig.createRateLimitFilter(redisTemplate);
    }

    /** The script returns {count, remaining window in ms}. */
    private void mockExecute(Long returnValue) {
        mockExecute(returnValue, 42_000L);
    }

    private void mockExecute(Long count, Long remainingMillis) {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<List<Long>>>any(), anyList(), anyString()))
                .thenReturn(List.of(count, remainingMillis));
    }

    private void mockExecuteForKey(String expectedKey, Long returnValue) {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<List<Long>>>any(), eq(List.of(expectedKey)),
                eq("60000")))
                .thenReturn(List.of(returnValue, 60_000L));
    }

    @Test
    void shouldAllowRequestsWithinLimit() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/v1/appointments");
        request.setRemoteAddr("127.0.0.1");

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain filterChain = mock(FilterChain.class);

        mockExecute(5L);

        filter.doFilter(request, response, filterChain);

        verify(filterChain, times(1)).doFilter(request, response);
        assertEquals(200, response.getStatus());
    }

    @Test
    void shouldBlockRequestsExceedingLimitForAuth() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/v1/auth/login");
        request.setRemoteAddr("192.168.1.1");

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain filterChain = mock(FilterChain.class);

        // Max requests for auth is 20, so returning 21 should block — Lua EVAL returns count atomically
        mockExecute(21L);

        filter.doFilter(request, response, filterChain);

        verify(filterChain, never()).doFilter(any(), any());
        assertEquals(429, response.getStatus());
        assertEquals("42", response.getHeader("Retry-After"), "the rest of the shared window, not a fixed 60");
        assertEquals("no-store", response.getHeader("Cache-Control"));
        var json = tools.jackson.databind.json.JsonMapper.builder().build().readTree(response.getContentAsString());
        assertEquals(429, json.get("status").asInt());
        assertEquals("Too Many Requests", json.get("error").asString());
        assertEquals("Too Many Requests", json.get("title").asString());
        assertEquals("Too many requests. Please try again later.", json.get("message").asString());
        assertEquals("Too many requests. Please try again later.", json.get("detail").asString());
        assertEquals("/api/v1/auth/login", json.get("path").asString());
        assertEquals("/api/v1/auth/login", json.get("instance").asString());
        assertEquals("about:blank", json.get("type").asString());
        assertNull(json.get("validationErrors"));
    }

    @Test
    void crossOriginRateLimitResponseCarriesCorsHeadersForAllowedOrigin() throws Exception {
        org.springframework.web.cors.CorsConfiguration cors = new org.springframework.web.cors.CorsConfiguration();
        cors.setAllowedOrigins(List.of("https://app.taskflow.example"));
        cors.setAllowCredentials(true);
        cors.setAllowedMethods(List.of("GET", "POST"));
        cors.setExposedHeaders(List.of("X-XSRF-TOKEN", "Retry-After"));
        org.springframework.web.cors.UrlBasedCorsConfigurationSource source =
                new org.springframework.web.cors.UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);

        OncePerRequestFilter corsAwareFilter = new RateLimiterConfig(
                100, 20, source, java.time.Clock.fixed(java.time.Instant.parse("2026-10-12T08:00:00Z"),
                java.time.ZoneOffset.UTC)).createRateLimitFilter(redisTemplate);
        mockExecute(21L);

        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/login");
        request.addHeader("Origin", "https://app.taskflow.example");
        request.setRemoteAddr("198.51.100.10");
        MockHttpServletResponse response = new MockHttpServletResponse();

        corsAwareFilter.doFilter(request, response, mock(FilterChain.class));

        assertEquals(429, response.getStatus());
        assertEquals("https://app.taskflow.example", response.getHeader("Access-Control-Allow-Origin"));
        assertTrue(response.getHeader("Access-Control-Expose-Headers").contains("Retry-After"));
    }

    @Test
    void retryAfterRoundsTheRemainingWindowUpToWholeSeconds() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/catalog");
        request.setRemoteAddr("192.0.2.4");
        MockHttpServletResponse response = new MockHttpServletResponse();
        mockExecute(101L, 41_001L);

        filter.doFilter(request, response, mock(FilterChain.class));

        assertEquals(429, response.getStatus());
        assertEquals("42", response.getHeader("Retry-After"));
    }

    @Test
    void retryAfterSecondsStaysWithinOneSecondAndTheWindow() {
        assertEquals(1, RateLimiterConfig.retryAfterSeconds(1));
        assertEquals(1, RateLimiterConfig.retryAfterSeconds(1_000));
        assertEquals(2, RateLimiterConfig.retryAfterSeconds(1_001));
        assertEquals(60, RateLimiterConfig.retryAfterSeconds(60_000));
        assertEquals(60, RateLimiterConfig.retryAfterSeconds(600_000), "never longer than the window");
        assertEquals(60, RateLimiterConfig.retryAfterSeconds(-1), "unknown remaining time: the whole window");
    }

    @Test
    void fallbackRetryAfterComesFromTheLocalWindow() throws Exception {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<List<Long>>>any(), anyList(), anyString()))
                .thenThrow(new RuntimeException("redis down"));

        MockHttpServletResponse response = null;
        for (int i = 0; i < 21; i++) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/login");
            request.setRemoteAddr("203.0.113.8");
            response = new MockHttpServletResponse();
            filter.doFilter(request, response, mock(FilterChain.class));
        }

        assertEquals(429, response.getStatus());
        long retryAfter = Long.parseLong(response.getHeader("Retry-After"));
        assertTrue(retryAfter >= 1 && retryAfter <= 60, "Retry-After from the per-JVM window: " + retryAfter);
    }

    @Test
    void logsTheRejectionOnlyWhenTheCounterFirstPassesTheLimit() throws Exception {
        ch.qos.logback.classic.Logger logger =
                (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(RateLimiterConfig.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            for (long count : new long[] {101L, 102L, 5000L}) {
                MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/catalog");
                request.setRemoteAddr("203.0.113.9");
                MockHttpServletResponse response = new MockHttpServletResponse();
                mockExecute(count);

                filter.doFilter(request, response, mock(FilterChain.class));

                assertEquals(429, response.getStatus());
            }
            assertEquals(1, appender.list.size(), "one WARN per client, bucket and window");
            assertTrue(appender.list.get(0).getFormattedMessage().contains("203.0.113.9"));
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void shouldBlockRequestsExceedingLimitForApi() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/v1/appointments");
        request.setRemoteAddr("127.0.0.1");

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain filterChain = mock(FilterChain.class);

        // Max requests for API is 100, so returning 101 should block
        mockExecute(101L);

        filter.doFilter(request, response, filterChain);

        verify(filterChain, never()).doFilter(any(), any());
        assertEquals(429, response.getStatus());
        assertTrue(response.getContentAsString().contains("Too many requests"));
    }

    @Test
    void shouldSetExpiryOnFirstRequest() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/v1/appointments");
        request.setRemoteAddr("127.0.0.1");

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain filterChain = mock(FilterChain.class);

        // Lua script atomically sets pexpire when c==1 — verify EVAL is invoked with correct TTL
        mockExecuteForKey("rate_limit:127.0.0.1:api", 1L);

        filter.doFilter(request, response, filterChain);

        verify(redisTemplate, times(1)).execute(ArgumentMatchers.<RedisScript<List<Long>>>any(), eq(List.of("rate_limit:127.0.0.1:api")), eq("60000"));
        verify(filterChain, times(1)).doFilter(request, response);
        assertEquals(200, response.getStatus());
    }

    @Test
    void shouldNotRateLimitHealthEndpoints() throws Exception {
        Arrays.asList("/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness")
                .forEach(path -> {
                    MockHttpServletRequest request = new MockHttpServletRequest();
                    request.setRequestURI(path);
                    request.setRemoteAddr("127.0.0.1");

                    MockHttpServletResponse response = new MockHttpServletResponse();
                    FilterChain filterChain = mock(FilterChain.class);

                    try {
                        filter.doFilter(request, response, filterChain);
                        verify(filterChain, times(1)).doFilter(request, response);
                        verifyNoInteractions(redisTemplate);
                    } catch (Exception e) {
                        fail("Filter should not have thrown for path " + path, e);
                    }
                    Mockito.clearInvocations(filterChain, redisTemplate);
                });
    }

    @Test
    void shouldNotCreateFilterBeanWhenRateLimitDisabled() {
        // matchIfMissing=false: the filter must NOT be created unless explicitly enabled.
        // Without Redis present this prevents a self-DoS (every request 500-ing).
        var context = new AnnotationConfigApplicationContext();
        context.register(RateLimiterConfig.class);
        // Property deliberately left unset (and would be false if set) -> bean absent.
        context.refresh();

        String[] names = context.getBeanNamesForType(org.springframework.boot.web.servlet.FilterRegistrationBean.class);
        boolean hasRateLimitFilter = java.util.Arrays.stream(names)
                .anyMatch(n -> n.toLowerCase().contains("rateLimit") || n.contains("rateLimitFilter"));
        assertFalse(hasRateLimitFilter, "Rate limiter filter must be absent when not explicitly enabled");

        context.close();
    }

    @Test
    void encodedAuthPathIsBilledToTheAuthBucket() throws Exception {
        // The raw request line hides "auth" behind %61, but the container decodes it
        // and routes the request to the login handler.
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/v1/%61uth/login");
        request.setServletPath("/api/v1/auth/login");
        request.setRemoteAddr("10.0.0.9");
        mockExecuteForKey("rate_limit:10.0.0.9:auth", 21L);

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain filterChain = mock(FilterChain.class);
        filter.doFilter(request, response, filterChain);

        assertEquals(429, response.getStatus(), "auth limit (20) must apply, not the API limit (100)");
        verify(filterChain, never()).doFilter(any(), any());
    }

    @Test
    void readOnlyAuthRequestsAreBilledToTheApiBucket() throws Exception {
        // Every web page load fetches the CSRF token; in the auth bucket ten loads a minute from
        // one shared address refused logins for everyone behind it.
        for (String path : List.of("/api/v1/auth/csrf", "/api/v1/auth/me")) {
            for (String method : List.of("GET", "HEAD")) {
                MockHttpServletRequest request = new MockHttpServletRequest(method, path);
                request.setRemoteAddr("10.0.0.10");
                mockExecuteForKey("rate_limit:10.0.0.10:api", 21L);

                MockHttpServletResponse response = new MockHttpServletResponse();
                FilterChain filterChain = mock(FilterChain.class);
                filter.doFilter(request, response, filterChain);

                assertEquals(200, response.getStatus(), method + " " + path + " must use the API limit (100)");
                verify(filterChain).doFilter(request, response);
            }
        }
    }

    @Test
    void stateChangingAuthRequestsKeepTheAuthBucket() throws Exception {
        for (String path : List.of("/api/v1/auth/login", "/api/v1/auth/mobile/login", "/api/v1/auth/register",
                "/api/v1/auth/refresh", "/api/v1/auth/mobile/refresh", "/api/v1/auth/logout")) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
            request.setRemoteAddr("10.0.0.11");
            mockExecuteForKey("rate_limit:10.0.0.11:auth", 21L);

            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, mock(FilterChain.class));

            assertEquals(429, response.getStatus(), "POST " + path + " must use the auth limit (20)");
        }
    }

    @Test
    void redisFailureFallsBackToAnInMemoryLimitInsteadOfFailingOpen() throws Exception {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<List<Long>>>any(), anyList(), anyString()))
                .thenThrow(new RuntimeException("redis down"));

        int blockedAt = -1;
        for (int i = 1; i <= 25; i++) {
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.setRequestURI("/api/v1/auth/login");
            request.setRemoteAddr("203.0.113.7");
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, mock(FilterChain.class));
            if (response.getStatus() == 429 && blockedAt < 0) {
                blockedAt = i;
            }
        }

        assertEquals(21, blockedAt, "the 21st auth request in the window is refused even with Redis down");
        // After the first failure Redis is skipped for a backoff period rather than
        // being retried (and timing out) on every request.
        verify(redisTemplate, times(1)).execute(ArgumentMatchers.<RedisScript<List<Long>>>any(), anyList(), anyString());
    }

    @Test
    void fallbackStillCountsAddressesSeparately() throws Exception {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<List<Long>>>any(), anyList(), anyString()))
                .thenThrow(new RuntimeException("redis down"));

        for (int i = 0; i < 21; i++) {
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.setRequestURI("/api/v1/auth/login");
            request.setRemoteAddr("198.51.100.1");
            filter.doFilter(request, new MockHttpServletResponse(), mock(FilterChain.class));
        }

        MockHttpServletRequest other = new MockHttpServletRequest();
        other.setRequestURI("/api/v1/auth/login");
        other.setRemoteAddr("198.51.100.2");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(other, response, mock(FilterChain.class));

        assertEquals(200, response.getStatus());
    }
}
