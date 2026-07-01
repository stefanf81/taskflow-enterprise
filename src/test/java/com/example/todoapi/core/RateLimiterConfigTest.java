package com.example.todoapi.core;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.time.Duration;

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
        rateLimiterConfig = new RateLimiterConfig();
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

        // Max requests for auth is 5, so returning 6 should block
        when(valueOperations.increment(eq("rate_limit:192.168.1.1:auth"))).thenReturn(6L);

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
}
