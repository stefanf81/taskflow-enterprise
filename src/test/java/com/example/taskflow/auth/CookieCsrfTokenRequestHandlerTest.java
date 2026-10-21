package com.example.taskflow.auth;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.DefaultCsrfToken;

import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class CookieCsrfTokenRequestHandlerTest {

    @Test
    void webCookieEagerlyLoadsTheReplacementToken() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("access_token", "web-token"));
        assertLoads(request, 1);
    }

    @Test
    void guestAndNativeRequestsKeepTokenLoadingDeferred() {
        assertLoads(new MockHttpServletRequest(), 0);
        MockHttpServletRequest nativeRequest = new MockHttpServletRequest();
        nativeRequest.addHeader("Authorization", "Bearer native-token");
        assertLoads(nativeRequest, 0);
    }

    @Test
    void xsrfAndEmptyAuthCookiesDoNotMakePublicResponsesEager() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("XSRF-TOKEN", "csrf"), new Cookie("access_token", " "));
        assertLoads(request, 0);
    }

    @Test
    void authenticationStrategyIssuesAReplacementInsteadOfOnlyClearingTheCookie() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("access_token", "web-token"), new Cookie("XSRF-TOKEN", "old-token"));
        MockHttpServletResponse response = new MockHttpServletResponse();
        CsrfAuthenticationStrategy strategy = new CsrfAuthenticationStrategy(CookieCsrfTokenRepository.withHttpOnlyFalse());
        strategy.setRequestHandler(new CookieCsrfTokenRequestHandler());

        strategy.onAuthentication(new TestingAuthenticationToken("admin", "password"), request, response);

        Cookie replacement = Arrays.stream(response.getCookies())
                .filter(cookie -> "XSRF-TOKEN".equals(cookie.getName()) && cookie.getMaxAge() != 0)
                .findFirst().orElseThrow();
        assertFalse(replacement.getValue().isBlank());
        assertNotEquals("old-token", replacement.getValue());
    }

    private void assertLoads(MockHttpServletRequest request, int expected) {
        AtomicInteger loads = new AtomicInteger();
        new CookieCsrfTokenRequestHandler().handle(request, new MockHttpServletResponse(), () -> {
            loads.incrementAndGet();
            return new DefaultCsrfToken("X-XSRF-TOKEN", "_csrf", "token");
        });
        assertEquals(expected, loads.get());
    }
}
