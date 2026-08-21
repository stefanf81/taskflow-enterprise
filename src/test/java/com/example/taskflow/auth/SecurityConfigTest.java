package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

import javax.sql.DataSource;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.logging.Logger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    private SecurityConfig createConfig(String admin, String pass, String privKey, String pubKey) {
        return new SecurityConfig(admin, pass, privKey, pubKey, "taskflow", "taskflow-api", false, dummyDataSource());
    }

    @Test
    void testLoadRsaKeyValid() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();

        String privBase64 = Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded());
        String pubBase64 = Base64.getEncoder().encodeToString(kp.getPublic().getEncoded());

        SecurityConfig config = createConfig("admin", "pass", privBase64, pubBase64);

        assertNotNull(config.jwtDecoder());
        assertNotNull(config.jwkSource());
        assertNotNull(config.jwtEncoder(config.jwkSource()));
    }

    @Test
    void testLoadRsaKeyInvalid() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "invalid-base64", "invalid-base64");
        assertNotNull(config.jwtDecoder()); // Should fallback to ephemeral keys
    }

    @Test
    void testLoadRsaKeyBlank() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "", "   ");
        assertNotNull(config.jwtDecoder());
    }

    @Test
    void testLoadRsaKeyPartiallyBlank() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "valid-fake-base", "");
        assertNotNull(config.jwtDecoder());
    }

    @Test
    void testJwtDecoderException() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", null, null);

        java.lang.reflect.Field rsaKeyField = SecurityConfig.class.getDeclaredField("rsaKey");
        rsaKeyField.setAccessible(true);
        rsaKeyField.set(config, null);

        assertThrows(IllegalStateException.class, () -> config.jwtDecoder());
    }

    @Test
    void testBeans() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", null, null);
        assertNotNull(config.passwordEncoder());
    }

    @Test
    void bearerOnlyRequestIsExemptFromCsrf() {
        SecurityConfig config = createConfig("admin", "pass", null, null);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer native-token");

        assertTrue(config.bearerOnlyRequestMatcher().matches(request));
    }

    @Test
    void cookieBearingRequestRemainsProtectedEvenWithBearerHeader() {
        SecurityConfig config = createConfig("admin", "pass", null, null);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer native-token");
        request.setCookies(new jakarta.servlet.http.Cookie("access_token", "web-token"));

        assertFalse(config.bearerOnlyRequestMatcher().matches(request));
    }

    @Test
    void csrfCookieIsReadableByAngularAndSameSiteStrict() {
        SecurityConfig config = createConfig("admin", "pass", null, null);
        CookieCsrfTokenRepository repository = config.csrfTokenRepository();
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        repository.saveToken(repository.generateToken(request), request, response);

        jakarta.servlet.http.Cookie cookie = response.getCookie("XSRF-TOKEN");
        assertNotNull(cookie);
        assertTrue("Strict".equals(cookie.getAttribute("SameSite")));
        assertFalse(cookie.isHttpOnly());
    }
}
