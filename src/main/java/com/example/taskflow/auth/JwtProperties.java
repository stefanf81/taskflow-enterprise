package com.example.taskflow.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The access tokens, bound from {@code app.jwt.*}.
 *
 * <ul>
 *   <li>{@code issuer} (default {@code taskflow}) and {@code audience} (default {@code taskflow-api}):
 *       written by {@link TokenProvider} and validated by the decoder (A3), so keep them stable.</li>
 *   <li>{@code lifetime-seconds} (default 3600): token and auth-cookie lifetime.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.jwt")
record JwtProperties(
        @DefaultValue("taskflow") String issuer,
        @DefaultValue("taskflow-api") String audience,
        @DefaultValue("3600") long lifetimeSeconds) {
}
