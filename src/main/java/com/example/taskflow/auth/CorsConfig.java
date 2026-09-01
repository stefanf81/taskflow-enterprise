package com.example.taskflow.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * Dedicated CORS configuration extracted from {@link SecurityConfig}
 * to keep that class focused on the security filter chain.
 */
@Configuration
public class CorsConfig {

    private final String allowedOrigins;

    public CorsConfig(
            @Value("${app.cors.allowed-origins:http://localhost:4200,http://127.0.0.1:4200}") String allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();

        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
        if (origins.isEmpty() || origins.contains("*")) {
            throw new IllegalStateException(
                    "app.cors.allowed-origins must be a non-empty, comma-separated list of explicit origins "
                            + "when allowCredentials=true.");
        }
        configuration.setAllowedOrigins(origins);
        configuration.setAllowCredentials(true);

        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Arrays.asList("Content-Type", "Authorization", "X-XSRF-TOKEN", "Idempotency-Key"));
        configuration.setExposedHeaders(Arrays.asList("Set-Cookie", "X-XSRF-TOKEN"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
