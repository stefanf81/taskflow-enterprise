package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfigurationSource;

import javax.sql.DataSource;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.logging.Logger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SecurityConfigTest {

    private DataSource dummyDataSource() {
        return new DataSource() {
            @Override public Connection getConnection() throws SQLException { return null; }
            @Override public Connection getConnection(String username, String password) throws SQLException { return null; }
            @Override public <T> T unwrap(Class<T> iface) throws SQLException { return null; }
            @Override public boolean isWrapperFor(Class<?> iface) throws SQLException { return false; }
            @Override public PrintWriter getLogWriter() throws SQLException { return null; }
            @Override public void setLogWriter(PrintWriter out) throws SQLException {}
            @Override public void setLoginTimeout(int seconds) throws SQLException {}
            @Override public int getLoginTimeout() throws SQLException { return 0; }
            @Override public Logger getParentLogger() throws SQLFeatureNotSupportedException { return null; }
        };
    }

    @Test
    void testCorsConfigurationSourceWithSpecificOrigin() throws Exception {
        SecurityConfig config = new SecurityConfig("admin", "pass", "http://localhost:3000", null, null, dummyDataSource());
        
        CorsConfigurationSource source = config.corsConfigurationSource();
        assertNotNull(source);
    }

    @Test
    void testCorsConfigurationSourceWithWildcard() throws Exception {
        SecurityConfig config = new SecurityConfig("admin", "pass", "*", null, null, dummyDataSource());
        
        CorsConfigurationSource source = config.corsConfigurationSource();
        assertNotNull(source);
    }

    @Test
    void testLoadRsaKeyValid() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();
        
        String privBase64 = Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded());
        String pubBase64 = Base64.getEncoder().encodeToString(kp.getPublic().getEncoded());
        
        SecurityConfig config = new SecurityConfig("admin", "pass", "*", privBase64, pubBase64, dummyDataSource());
        
        assertNotNull(config.jwtDecoder());
        assertNotNull(config.jwkSource());
        assertNotNull(config.jwtEncoder(config.jwkSource()));
    }

    @Test
    void testLoadRsaKeyInvalid() throws Exception {
        SecurityConfig config = new SecurityConfig("admin", "pass", "*", "invalid-base64", "invalid-base64", dummyDataSource());
        
        assertNotNull(config.jwtDecoder()); // Should fallback to ephemeral keys
    }

    @Test
    void testLoadRsaKeyBlank() throws Exception {
        SecurityConfig config = new SecurityConfig("admin", "pass", "*", "", "   ", dummyDataSource());
        assertNotNull(config.jwtDecoder()); 
    }
    
    @Test
    void testLoadRsaKeyPartiallyBlank() throws Exception {
        SecurityConfig config = new SecurityConfig("admin", "pass", "*", "valid-fake-base", "", dummyDataSource());
        assertNotNull(config.jwtDecoder()); 
    }

    @Test
    void testJwtDecoderException() throws Exception {
        SecurityConfig config = new SecurityConfig("admin", "pass", "*", null, null, dummyDataSource());
        
        java.lang.reflect.Field rsaKeyField = SecurityConfig.class.getDeclaredField("rsaKey");
        rsaKeyField.setAccessible(true);
        rsaKeyField.set(config, null);
        
        assertThrows(IllegalStateException.class, () -> config.jwtDecoder());
    }

    @Test
    void testBeans() throws Exception {
        SecurityConfig config = new SecurityConfig("admin", "pass", "*", null, null, dummyDataSource());
        
        assertNotNull(config.passwordEncoder());
        assertNotNull(config.webSecurityCustomizer());
    }
}
