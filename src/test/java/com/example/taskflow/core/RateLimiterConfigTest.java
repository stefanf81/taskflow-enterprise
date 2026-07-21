package com.example.taskflow.core;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.time.Duration;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RateLimiterConfigTest {

    private RateLimiterConfig rateLimiterConfig;
    private StringRedisTemplate redisTemplate;
    private ValueOperations<String, String> valueOperations;
    private OncePerRequestFilter filter;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        rateLimiterConfig = new RateLimiterConfig(100, 20);
        redisTemplate = mock(StringRedisTemplate.class);
        valueOperations = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        filter = rateLimiterConfig.rateLimitFilter(redisTemplate);
    }

    @Test
    void shouldAllowRequestsWithinLimit() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/v1/appointments");
        request.setRemoteAddr("127.0.0.1");

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain filterChain = mock(FilterChain.class);

        when(valueOperations.increment(eq("rate_limit:127.0.0.1:api"))).thenReturn(5L);

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

        // Max requests for auth is 20, so returning 21 should block
        when(valueOperations.increment(eq("rate_limit:192.168.1.1:auth"))).thenReturn(21L);

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
        when(valueOperations.increment(eq("rate_limit:127.0.0.1:api"))).thenReturn(101L);

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

        when(valueOperations.increment(eq("rate_limit:127.0.0.1:api"))).thenReturn(1L);

        filter.doFilter(request, response, filterChain);

        verify(redisTemplate, times(1)).expire(eq("rate_limit:127.0.0.1:api"), eq(Duration.ofMinutes(1)));
        verify(filterChain, times(1)).doFilter(request, response);
        assertEquals(200, response.getStatus());
    }

    @Test
    void shouldNotCreateFilterBeanWhenRateLimitDisabled() {
        // matchIfMissing=false: the filter must NOT be created unless explicitly enabled.
        // Without Redis present this prevents a self-DoS (every request 500-ing).
        var context = new AnnotationConfigApplicationContext();
        context.register(RateLimiterConfig.class);
        // Property deliberately left unset (and would be false if set) -> bean absent.
        context.refresh();

        String[] names = context.getBeanNamesForType(OncePerRequestFilter.class);
        boolean hasRateLimitFilter = java.util.Arrays.stream(names)
                .anyMatch(n -> n.toLowerCase().contains("rateLimit") || n.contains("rateLimitFilter"));
        assertFalse(hasRateLimitFilter, "Rate limiter filter must be absent when not explicitly enabled");

        context.close();
    }
}
