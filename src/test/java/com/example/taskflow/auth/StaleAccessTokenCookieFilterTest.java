package com.example.taskflow.auth;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import jakarta.servlet.http.HttpServletRequest;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class StaleAccessTokenCookieFilterTest {

    private final JwtDecoder decoder = mock(JwtDecoder.class);
    private final StaleAccessTokenCookieFilter filter = new StaleAccessTokenCookieFilter(decoder, true);

    @Test
    void invalidCookieIsExpiredAndHiddenFromTheRestOfTheChain() throws Exception {
        when(decoder.decode(anyString())).thenThrow(new BadJwtException("signature mismatch"));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("access_token", "stale"), new Cookie("XSRF-TOKEN", "csrf"));
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        HttpServletRequest seen = (HttpServletRequest) chain.getRequest();
        assertNotNull(seen, "request must still proceed (anonymous)");
        assertEquals(1, seen.getCookies().length);
        assertEquals("XSRF-TOKEN", seen.getCookies()[0].getName(), "unrelated cookies are preserved");

        String setCookie = response.getHeader("Set-Cookie");
        assertNotNull(setCookie);
        assertTrue(setCookie.contains("access_token="));
        assertTrue(setCookie.contains("Max-Age=0"));
        assertTrue(setCookie.contains("HttpOnly"));
        assertTrue(setCookie.contains("Secure"));
        assertTrue(setCookie.contains("SameSite=Strict"));
    }

    @Test
    void onlyAccessTokenCookieMeansNoCookiesAtAll() throws Exception {
        when(decoder.decode(anyString())).thenThrow(new BadJwtException("expired"));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("access_token", "stale"));
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertNull(((HttpServletRequest) chain.getRequest()).getCookies());
    }

    @Test
    void validCookiePassesThroughUntouched() throws Exception {
        when(decoder.decode("good")).thenReturn(mock(Jwt.class));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("access_token", "good"));
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertSame(request, chain.getRequest());
        assertNull(response.getHeader("Set-Cookie"));
    }

    @Test
    void requestsWithoutTheCookieAreNotDecoded() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), chain);
        request.setCookies(new Cookie("access_token", "  "));
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        org.mockito.Mockito.verifyNoInteractions(decoder);
        assertSame(request, chain.getRequest());
    }
}
