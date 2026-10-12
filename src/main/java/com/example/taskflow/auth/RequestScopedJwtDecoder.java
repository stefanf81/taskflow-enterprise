package com.example.taskflow.auth;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

/**
 * Decodes each token at most once per HTTP request.
 *
 * <p>For cookie-authenticated requests the token is decoded twice in the filter chain: first by
 * {@link StaleAccessTokenCookieFilter} (to drop a dead cookie before it can 401 public pages),
 * then by the resource server's bearer-token filter. Each decode is an RSA signature check plus
 * the validator chain. This wrapper remembers the successfully decoded {@link Jwt} in the current
 * request's attributes and returns it when the <em>same</em> token string is decoded again in that
 * request. Failures are never cached, and outside a request (or for a different token) it simply
 * delegates.
 */
final class RequestScopedJwtDecoder implements JwtDecoder {

    static final String ATTRIBUTE = RequestScopedJwtDecoder.class.getName() + ".decoded";

    private final JwtDecoder delegate;

    RequestScopedJwtDecoder(JwtDecoder delegate) {
        this.delegate = delegate;
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes != null
                && attributes.getAttribute(ATTRIBUTE, RequestAttributes.SCOPE_REQUEST) instanceof Jwt cached
                && cached.getTokenValue().equals(token)) {
            return cached;
        }
        Jwt jwt = delegate.decode(token);
        if (attributes != null) {
            attributes.setAttribute(ATTRIBUTE, jwt, RequestAttributes.SCOPE_REQUEST);
        }
        return jwt;
    }
}
