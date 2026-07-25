package com.example.taskflow.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.Collections;

/**
 * Dedicated CORS configuration extracted from {@link SecurityConfig}
 * to keep that class focused on the security filter chain.
 */
@Configuration
public class CorsConfig {

    private static final Logger logger = LoggerFactory.getLogger(CorsConfig.class);

    private final String allowedOrigins;
    private final Environment environment;

    public CorsConfig(
            @Value("${app.cors.allowed-origins:*}") String allowedOrigins,
            Environment environment) {
        this.allowedOrigins = allowedOrigins;
        this.environment = environment;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();

        if ("*".equals(allowedOrigins)) {
            // WARN: a wildcard origin combined with allowCredentials=true trusts
            // any origin with cookies. This is acceptable for local dev only —
            // in production, app.cors.allowed-origins must list explicit origins
            // (see application-prod.properties). Fail-fast in non-dev profiles to
            // prevent an accidental wildcard from shipping to prod.
            boolean isProd = environment != null
                    && Arrays.asList(environment.getActiveProfiles()).contains("prod")
                    && !Arrays.asList(environment.getActiveProfiles()).contains("dev");
            if (isProd) {
                throw new IllegalStateException(
                        "app.cors.allowed-origins is '*' with allowCredentials=true in a prod profile. "
                                + "Set app.cors.allowed-origins to an explicit, comma-separated origin list (e.g. "
                                + "'https://example.com') in application-prod.properties.");
            }
            logger.warn("CORS is configured with a wildcard origin AND allowCredentials=true. "
                    + "This is acceptable for local dev only — set explicit origins in production.");
            configuration.setAllowedOriginPatterns(Collections.singletonList("*"));
            configuration.setAllowCredentials(true);
        } else {
            configuration.setAllowedOrigins(Arrays.asList(allowedOrigins.split(",")));
            configuration.setAllowCredentials(true);
        }

        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Arrays.asList("Content-Type", "Authorization", "X-XSRF-TOKEN", "Idempotency-Key"));
        configuration.setExposedHeaders(Arrays.asList("Set-Cookie", "X-XSRF-TOKEN"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
