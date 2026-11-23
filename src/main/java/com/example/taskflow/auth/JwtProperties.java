package com.example.taskflow.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * The access tokens, bound from {@code app.jwt.*}.
 *
 * <ul>
 *   <li>{@code issuer} (default {@code taskflow}) and {@code audience} (default {@code taskflow-api}):
 *       written by {@link TokenProvider} and validated by the decoder (A3), so keep them stable.</li>
 *   <li>{@code lifetime-seconds} (default 3600): token and auth-cookie lifetime, 60 to 86400.
 *       Outside that range the start fails: at 0 or below every token is expired when it is issued
 *       (each login succeeds and the next request answers 401), below the decoder's 60 s clock-skew
 *       allowance the value no longer decides when a token ends, and a mistyped large value
 *       (milliseconds for seconds) would keep a stolen token valid for weeks. Sessions longer than
 *       a day come from the refresh sessions ({@link RefreshProperties}), not from this value.</li>
 * </ul>
 */
@Validated
@ConfigurationProperties(prefix = "app.jwt")
record JwtProperties(
        @DefaultValue("taskflow") String issuer,
        @DefaultValue("taskflow-api") String audience,
        @DefaultValue("3600") @Min(MIN_LIFETIME_SECONDS) @Max(MAX_LIFETIME_SECONDS) long lifetimeSeconds) {

    static final long MIN_LIFETIME_SECONDS = 60;
    static final long MAX_LIFETIME_SECONDS = 86_400;
}
