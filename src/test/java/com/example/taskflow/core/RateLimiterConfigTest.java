package com.example.taskflow.core;

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

    private void mockExecute(Long returnValue) {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<Long>>any(), anyList(), anyString()))
                .thenReturn(returnValue);
    }

    private void mockExecuteForKey(String expectedKey, Long returnValue) {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<Long>>any(), eq(List.of(expectedKey)), eq("60000")))
                .thenReturn(returnValue);
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
        assertEquals("60", response.getHeader("Retry-After"));
        assertTrue(response.getContentAsString().contains("Too many requests"));
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

        verify(redisTemplate, times(1)).execute(ArgumentMatchers.<RedisScript<Long>>any(), eq(List.of("rate_limit:127.0.0.1:api")), eq("60000"));
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
    void redisFailureFallsBackToAnInMemoryLimitInsteadOfFailingOpen() throws Exception {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<Long>>any(), anyList(), anyString()))
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
        verify(redisTemplate, times(1)).execute(ArgumentMatchers.<RedisScript<Long>>any(), anyList(), anyString());
    }

    @Test
    void fallbackStillCountsAddressesSeparately() throws Exception {
        when(redisTemplate.execute(ArgumentMatchers.<RedisScript<Long>>any(), anyList(), anyString()))
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
