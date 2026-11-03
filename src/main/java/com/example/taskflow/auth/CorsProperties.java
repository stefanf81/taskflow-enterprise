package com.example.taskflow.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Cross-origin access, bound from {@code app.cors.*} (see {@link CorsConfig}).
 *
 * <ul>
 *   <li>{@code allowed-origins} (default {@code http://localhost:4200,http://127.0.0.1:4200}): a
 *       comma-separated list of explicit origins. Prod sets it from {@code APP_CORS_ALLOWED_ORIGINS}
 *       without a fallback, and an empty value aborts the start.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.cors")
record CorsProperties(@DefaultValue("http://localhost:4200,http://127.0.0.1:4200") String allowedOrigins) {
}
