package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.core.env.Environment;
import org.springframework.web.cors.CorsConfigurationSource;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CorsConfigTest {

    private Environment devEnv() {
        Environment env = mock(Environment.class);
        when(env.getActiveProfiles()).thenReturn(new String[]{"dev"});
        return env;
    }

    private Environment prodEnv() {
        Environment env = mock(Environment.class);
        when(env.getActiveProfiles()).thenReturn(new String[]{"prod"});
        return env;
    }

    @Test
    void testCorsConfigurationSourceWithSpecificOrigin() {
        CorsConfig config = new CorsConfig("http://localhost:3000", devEnv());
        CorsConfigurationSource source = config.corsConfigurationSource();
        assertNotNull(source);
    }

    @Test
    void testCorsConfigurationSourceWithWildcard() {
        // Wildcard + credentials is permitted in dev (no prod profile active).
        CorsConfig config = new CorsConfig("*", devEnv());
        CorsConfigurationSource source = config.corsConfigurationSource();
        assertNotNull(source);
    }

    @Test
    void testWildcardWithProdProfileFailsFast() {
        // A wildcard origin with credentials must never ship to prod.
        CorsConfig config = new CorsConfig("*", prodEnv());
        assertThrows(IllegalStateException.class, config::corsConfigurationSource);
    }
}