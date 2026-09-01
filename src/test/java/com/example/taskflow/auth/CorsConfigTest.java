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
        CorsConfig config = new CorsConfig("http://localhost:4200,http://127.0.0.1:4200");
        CorsConfigurationSource source = config.corsConfigurationSource();
        CorsConfiguration corsConfiguration = source.getCorsConfiguration(new MockHttpServletRequest());

        assertNotNull(source);
        assertNotNull(corsConfiguration);
        assertEquals(
                "http://localhost:4200,http://127.0.0.1:4200",
                String.join(",", corsConfiguration.getAllowedOrigins()));
    }

    @Test
    void wildcardOriginFailsFast() {
        CorsConfig config = new CorsConfig("*");
        assertThrows(IllegalStateException.class, config::corsConfigurationSource);
    }
}
