package com.example.taskflow.auth;

import org.springframework.http.HttpMethod;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.function.Supplier;

/**
 * Who may read {@code /actuator/prometheus}: anyone while no {@code app.metrics.scrape-token} is
 * configured (the network keeps it internal), otherwise only a request carrying that token as a
 * bearer credential (https://github.com/stefanf81/taskflow-enterprise/issues/223).
 *
 * <p>The scrape token is not a JWT, so {@link SecurityConfig#cookieBearerTokenResolver()} skips this
 * path ({@link #SCRAPE}): the resource server would otherwise try to decode it and answer 401. Both
 * sides are hashed before they are compared, so the comparison takes the same time for any input.
 */
final class MetricsScrapeAuthorization implements AuthorizationManager<RequestAuthorizationContext> {

    /** The one endpoint the scrape token is for. */
    static final RequestMatcher SCRAPE = PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/actuator/prometheus");

    private static final String BEARER = "Bearer ";

    private final byte[] expected;

    MetricsScrapeAuthorization(String scrapeToken) {
        this.expected = scrapeToken == null || scrapeToken.isBlank() ? null : sha256(scrapeToken.strip());
    }

    boolean protectsTheEndpoint() {
        return expected != null;
    }

    @Override
    public AuthorizationDecision authorize(Supplier<? extends Authentication> authentication,
                                           RequestAuthorizationContext context) {
        return new AuthorizationDecision(expected == null || MessageDigest.isEqual(expected, sha256(presented(context.getRequest()))));
    }

    private static String presented(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, BEARER, 0, BEARER.length())) {
            return "";
        }
        return header.substring(BEARER.length()).strip();
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is part of every JRE", e);
        }
    }
}
