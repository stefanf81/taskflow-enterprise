package com.example.taskflow.auth;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

import java.util.function.Supplier;

/**
 * Resolve Angular's plain double-submit header and refresh its cookie after authentication.
 * Spring's CsrfAuthenticationStrategy clears the previous token, then invokes this handler
 * again. Loading the replacement immediately prevents the next SPA mutation losing its token.
 * Unlike the globally eager SPA defaults, guest/public and native bearer requests stay deferred:
 * cached public responses must not mint a different XSRF cookie on every request.
 */
final class CookieCsrfTokenRequestHandler extends CsrfTokenRequestAttributeHandler {

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> csrfToken) {
        super.handle(request, response, csrfToken);
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if (StaleAccessTokenCookieFilter.COOKIE_NAME.equals(cookie.getName())
                        && cookie.getValue() != null && !cookie.getValue().isBlank()) {
                    csrfToken.get();
                    return;
                }
            }
        }
    }
}
