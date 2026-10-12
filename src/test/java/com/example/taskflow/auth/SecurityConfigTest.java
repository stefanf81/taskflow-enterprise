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

import com.example.taskflow.auth.internal.UserRepository;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.junit.jupiter.api.Assertions.assertEquals;
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
        return new SecurityConfig(admin, pass, privKey, pubKey, false, "taskflow", "taskflow-api", false, dummyDataSource());
    }

    @Test
    void testLoadRsaKeyValid() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();

        String privBase64 = Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded());
        String pubBase64 = Base64.getEncoder().encodeToString(kp.getPublic().getEncoded());

        SecurityConfig config = createConfig("admin", "pass", privBase64, pubBase64);

        assertNotNull(config.jwtDecoder(new TokenRevocationList()));
        assertNotNull(config.jwkSource());
        assertNotNull(config.jwtEncoder(config.jwkSource()));
    }

    @Test
    void testLoadRsaKeyInvalid() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "invalid-base64", "invalid-base64");
        assertNotNull(config.jwtDecoder(new TokenRevocationList())); // Should fallback to ephemeral keys
    }

    @Test
    void testLoadRsaKeyBlank() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "", "   ");
        assertNotNull(config.jwtDecoder(new TokenRevocationList()));
    }

    @Test
    void testLoadRsaKeyPartiallyBlank() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "valid-fake-base", "");
        assertNotNull(config.jwtDecoder(new TokenRevocationList()));
    }

    @Test
    void productionRequiresPersistentKeys() {
        assertThrows(IllegalStateException.class, () -> new SecurityConfig(
                "admin", "pass", null, null, true, "taskflow", "taskflow-api", false, dummyDataSource()));
    }

    @Test
    void productionRejectsInvalidPersistentKeys() {
        assertThrows(IllegalStateException.class, () -> new SecurityConfig(
                "admin", "pass", "invalid-base64", "invalid-base64", true,
                "taskflow", "taskflow-api", false, dummyDataSource()));
    }

    @Test
    void testJwtDecoderException() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", null, null);

        java.lang.reflect.Field rsaKeyField = SecurityConfig.class.getDeclaredField("rsaKey");
        rsaKeyField.setAccessible(true);
        rsaKeyField.set(config, null);

        assertThrows(IllegalStateException.class, () -> config.jwtDecoder(new TokenRevocationList()));
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

    // ---- admin account bootstrap ----

    @Test
    void initAdminUser_createsTheAdminWhenMissing() throws Exception {
        SecurityConfig config = createConfig("admin", "s3cret-pass", null, null);
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmailIgnoreCase("admin")).thenReturn(Optional.empty());
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

        config.initAdminUser(users, encoder).run();

        org.mockito.ArgumentCaptor<AppUser> saved = org.mockito.ArgumentCaptor.forClass(AppUser.class);
        verify(users).save(saved.capture());
        assertEquals("ROLE_ADMIN", saved.getValue().getRole());
        assertTrue(encoder.matches("s3cret-pass", saved.getValue().getPasswordHash()));
    }

    @Test
    void initAdminUser_resyncsAStalePasswordFromConfiguration() throws Exception {
        // First boot used the development default; the operator has since set a real
        // SPRING_SECURITY_PASSWORD. The stored hash must follow the configuration.
        SecurityConfig config = createConfig("admin", "new-strong-pass", null, null);
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AppUser existing = new AppUser("admin", encoder.encode("admin-password"), "Shop Owner", "", "ROLE_ADMIN");
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmailIgnoreCase("admin")).thenReturn(Optional.of(existing));

        config.initAdminUser(users, encoder).run();

        verify(users).save(existing);
        assertTrue(encoder.matches("new-strong-pass", existing.getPasswordHash()));
        assertFalse(encoder.matches("admin-password", existing.getPasswordHash()));
    }

    @Test
    void initAdminUser_leavesAMatchingPasswordAlone() throws Exception {
        SecurityConfig config = createConfig("admin", "same-pass", null, null);
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AppUser existing = new AppUser("admin", encoder.encode("same-pass"), "Shop Owner", "", "ROLE_ADMIN");
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmailIgnoreCase("admin")).thenReturn(Optional.of(existing));

        config.initAdminUser(users, encoder).run();

        verify(users, never()).save(any());
    }

    @Test
    void initAdminUser_neverRewritesANonAdminAccountThatSharesTheName() throws Exception {
        SecurityConfig config = createConfig("admin", "whatever", null, null);
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AppUser customer = new AppUser("admin", encoder.encode("customer-chosen"), "Not Admin", "", "ROLE_CUSTOMER");
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmailIgnoreCase("admin")).thenReturn(Optional.of(customer));

        config.initAdminUser(users, encoder).run();

        verify(users, never()).save(any());
        assertTrue(encoder.matches("customer-chosen", customer.getPasswordHash()));
    }

    @Test
    void cookieSecureDefaultsToTrueInBothPlaces() throws Exception {
        // SecurityConfig and AuthController must agree on the fail-safe default.
        var securityConfigParam = SecurityConfig.class.getConstructors()[0].getParameters();
        boolean found = false;
        for (var p : securityConfigParam) {
            var v = p.getAnnotation(org.springframework.beans.factory.annotation.Value.class);
            if (v != null && v.value().startsWith("${app.cookie.secure")) {
                assertEquals("${app.cookie.secure:true}", v.value());
                found = true;
            }
        }
        assertTrue(found);
    }
}
