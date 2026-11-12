package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CorsConfigTest {

    @Test
    void testCorsConfigurationSourceWithSpecificOrigin() {
        CorsConfig config = new CorsConfig(new CorsProperties("http://localhost:4200,http://127.0.0.1:4200"));
        CorsConfigurationSource source = config.corsConfigurationSource();
        CorsConfiguration corsConfiguration = source.getCorsConfiguration(new MockHttpServletRequest());

        assertNotNull(source);
        assertNotNull(corsConfiguration);
        assertEquals(
                "http://localhost:4200,http://127.0.0.1:4200",
                String.join(",", corsConfiguration.getAllowedOrigins()));
    }

    @Test
    void exposesNoForbiddenResponseHeader() {
        CorsConfiguration corsConfiguration = new CorsConfig(new CorsProperties("http://localhost:4200")).corsConfigurationSource()
                .getCorsConfiguration(new MockHttpServletRequest());

        assertNotNull(corsConfiguration);
        // Set-Cookie is a forbidden response header name: browsers never expose it to scripts.
        assertEquals(java.util.List.of("X-XSRF-TOKEN", "Retry-After"), corsConfiguration.getExposedHeaders());
    }

    @Test
    void wildcardOriginFailsFast() {
        CorsConfig config = new CorsConfig(new CorsProperties("*"));
        assertThrows(IllegalStateException.class, config::corsConfigurationSource);
    }
}
