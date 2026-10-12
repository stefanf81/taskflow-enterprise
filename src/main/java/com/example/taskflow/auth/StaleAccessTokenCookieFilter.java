package com.example.taskflow.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;

/**
 * Stops a dead {@code access_token} cookie from breaking the whole API.
 *
 * <p>The bearer resolver always prefers the cookie, and the resource-server
 * filter answers an unverifiable token with 401 <em>before</em> any
 * {@code permitAll} rule is consulted. After an RSA key change, a restart with
 * an ephemeral key, expiry or a revoked token, the browser would therefore keep
 * sending a cookie that JavaScript cannot clear (it is HttpOnly), and login,
 * logout, the catalog and guest booking would all answer 401.
 *
 * <p>This filter validates the cookie with the same decoder the resource server
 * uses. If it is invalid it (1) expires the cookie in the response and (2) hides
 * it from the rest of the chain, so the request proceeds as anonymous: public
 * endpoints work and protected ones still return a normal 401. Valid cookies
 * pass through untouched. Hiding it also keeps the CSRF decision consistent —
 * a cookie that authenticates nothing is not an ambient credential.
 */
public class StaleAccessTokenCookieFilter extends OncePerRequestFilter {

    static final String COOKIE_NAME = "access_token";

    private final JwtDecoder jwtDecoder;
    private final boolean cookieSecure;

    public StaleAccessTokenCookieFilter(JwtDecoder jwtDecoder, boolean cookieSecure) {
        this.jwtDecoder = jwtDecoder;
        this.cookieSecure = cookieSecure;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            chain.doFilter(request, response);
            return;
        }
        for (Cookie cookie : cookies) {
            if (COOKIE_NAME.equals(cookie.getName())
                    && cookie.getValue() != null && !cookie.getValue().isBlank()
                    && !isValid(cookie.getValue())) {
                response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(COOKIE_NAME, "")
                        .httpOnly(true)
                        .secure(cookieSecure)
                        .sameSite("Strict")
                        .path("/")
                        .maxAge(0)
                        .build().toString());
                chain.doFilter(new WithoutAccessTokenCookie(request), response);
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private boolean isValid(String token) {
        try {
            jwtDecoder.decode(token);
            return true;
        } catch (JwtException e) {
            return false;
        }
    }

    private static final class WithoutAccessTokenCookie extends HttpServletRequestWrapper {

        WithoutAccessTokenCookie(HttpServletRequest request) {
            super(request);
        }

        @Override
        public Cookie[] getCookies() {
            Cookie[] cookies = super.getCookies();
            if (cookies == null) {
                return null;
            }
            Cookie[] kept = Arrays.stream(cookies)
                    .filter(c -> !COOKIE_NAME.equals(c.getName()))
                    .toArray(Cookie[]::new);
            return kept.length == 0 ? null : kept;
        }
    }
}
