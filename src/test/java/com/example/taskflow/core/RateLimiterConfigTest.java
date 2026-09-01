package com.example.taskflow.core;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
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
    @SuppressWarnings("unchecked")
    void setUp() {
        rateLimiterConfig = new RateLimiterConfig(100, 20);
        redisTemplate = mock(StringRedisTemplate.class);
        filter = rateLimiterConfig.createRateLimitFilter(redisTemplate);
    }

    @SuppressWarnings("unchecked")
    private void mockExecute(Long returnValue) {
        when(redisTemplate.execute(any(DefaultRedisScript.class), anyList(), anyString()))
                .thenReturn(returnValue);
    }

    @SuppressWarnings("unchecked")
    private void mockExecuteForKey(String expectedKey, Long returnValue) {
        when(redisTemplate.execute(any(DefaultRedisScript.class), eq(List.of(expectedKey)), eq("60000")))
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

        verify(redisTemplate, times(1)).execute(any(DefaultRedisScript.class), eq(List.of("rate_limit:127.0.0.1:api")), eq("60000"));
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
}
