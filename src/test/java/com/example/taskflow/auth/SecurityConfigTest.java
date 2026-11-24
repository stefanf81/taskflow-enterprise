package com.example.taskflow.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.taskflow.auth.internal.UserRepository;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

class SecurityConfigTest {

    private final AccountTokenCheck accounts = mock(AccountTokenCheck.class);

    private SecurityConfig createConfig(String admin, String pass, String privKey, String pubKey) {
        return new SecurityConfig(
                admin,
                pass,
                new RsaKeyProperties(privKey, pubKey, false),
                new JwtProperties("taskflow", "taskflow-api", 3600),
                new CookieProperties(false));
    }

    @Test
    void testLoadRsaKeyValid() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();

        String privBase64 = Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded());
        String pubBase64 = Base64.getEncoder().encodeToString(kp.getPublic().getEncoded());

        SecurityConfig config = createConfig("admin", "pass", privBase64, pubBase64);

        assertNotNull(config.jwtDecoder(
                new TokenRevocationList(), mock(AccountTokenCheck.class), mock(RefreshSessionService.class)));
        assertNotNull(config.jwkSource());
        assertNotNull(config.jwtEncoder(config.jwkSource()));
    }

    @Test
    void testLoadRsaKeyInvalid() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "invalid-base64", "invalid-base64");
        assertNotNull(config.jwtDecoder(
                new TokenRevocationList(),
                mock(AccountTokenCheck.class),
                mock(RefreshSessionService.class))); // Should fallback to ephemeral keys
    }

    @Test
    void testLoadRsaKeyBlank() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "", "   ");
        assertNotNull(config.jwtDecoder(
                new TokenRevocationList(), mock(AccountTokenCheck.class), mock(RefreshSessionService.class)));
    }

    @Test
    void testLoadRsaKeyPartiallyBlank() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", "valid-fake-base", "");
        assertNotNull(config.jwtDecoder(
                new TokenRevocationList(), mock(AccountTokenCheck.class), mock(RefreshSessionService.class)));
    }

    @Test
    void productionRequiresPersistentKeys() {
        assertThrows(
                IllegalStateException.class,
                () -> new SecurityConfig(
                        "admin",
                        "pass",
                        new RsaKeyProperties(null, null, true),
                        new JwtProperties("taskflow", "taskflow-api", 3600),
                        new CookieProperties(false)));
    }

    @Test
    void productionRejectsInvalidPersistentKeys() {
        assertThrows(
                IllegalStateException.class,
                () -> new SecurityConfig(
                        "admin",
                        "pass",
                        new RsaKeyProperties("invalid-base64", "invalid-base64", true),
                        new JwtProperties("taskflow", "taskflow-api", 3600),
                        new CookieProperties(false)));
    }

    // ---- configured key pair: the two halves must belong together and be long enough ----

    private static KeyPair rsa() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        return kpg.generateKeyPair();
    }

    /**
     * A deliberately undersized (1024-bit) pair, to prove the production check rejects it. It is
     * assembled from two primes instead of {@code KeyPairGenerator.initialize(1024)} so no code path
     * in this repository asks the JDK for a weak key (CodeQL {@code java/insufficient-key-size}).
     */
    private static KeyPair weakRsa1024() throws Exception {
        var random = new java.security.SecureRandom();
        var e = java.security.spec.RSAKeyGenParameterSpec.F4;
        java.math.BigInteger p;
        java.math.BigInteger q;
        java.math.BigInteger n;
        java.math.BigInteger phi;
        do {
            p = java.math.BigInteger.probablePrime(512, random);
            q = java.math.BigInteger.probablePrime(512, random);
            n = p.multiply(q);
            phi = p.subtract(java.math.BigInteger.ONE).multiply(q.subtract(java.math.BigInteger.ONE));
        } while (p.equals(q) || n.bitLength() != 1024 || !phi.gcd(e).equals(java.math.BigInteger.ONE));
        var d = e.modInverse(phi);
        var factory = java.security.KeyFactory.getInstance("RSA");
        return new KeyPair(
                factory.generatePublic(new java.security.spec.RSAPublicKeySpec(n, e)),
                factory.generatePrivate(new java.security.spec.RSAPrivateCrtKeySpec(
                        n,
                        e,
                        d,
                        p,
                        q,
                        d.mod(p.subtract(java.math.BigInteger.ONE)),
                        d.mod(q.subtract(java.math.BigInteger.ONE)),
                        q.modInverse(p))));
    }

    private static String b64(java.security.Key key) {
        return Base64.getEncoder().encodeToString(key.getEncoded());
    }

    private static Throwable root(Throwable t) {
        while (t.getCause() != null) {
            t = t.getCause();
        }
        return t;
    }

    @Test
    void productionRejectsAPublicKeyOfAnotherPair() throws Exception {
        // Each half is a valid key, so both parse: before the pair check this started and every
        // token it issued failed its own decoder.
        KeyPair signing = rsa();
        KeyPair other = rsa();

        IllegalStateException failure = assertThrows(
                IllegalStateException.class,
                () -> new SecurityConfig(
                        "admin",
                        "pass",
                        new RsaKeyProperties(b64(signing.getPrivate()), b64(other.getPublic()), true),
                        new JwtProperties("taskflow", "taskflow-api", 3600),
                        new CookieProperties(false)));

        String message = root(failure).getMessage();
        assertTrue(message.contains("APP_RSA_PUBLIC_KEY is not the public key of APP_RSA_PRIVATE_KEY"), message);
        // No key material in the message that ends up in the startup log.
        assertFalse(message.contains(b64(other.getPublic()).substring(0, 24)), message);
    }

    @Test
    void productionRejectsAKeyBelow2048Bits() throws Exception {
        KeyPair weak = weakRsa1024();

        IllegalStateException failure = assertThrows(
                IllegalStateException.class,
                () -> new SecurityConfig(
                        "admin",
                        "pass",
                        new RsaKeyProperties(b64(weak.getPrivate()), b64(weak.getPublic()), true),
                        new JwtProperties("taskflow", "taskflow-api", 3600),
                        new CookieProperties(false)));

        assertTrue(
                root(failure).getMessage().contains("1024-bit"), root(failure).getMessage());
    }

    @Test
    void aMismatchedPairOutsideProductionFallsBackToAnEphemeralPairThatWorks() throws Exception {
        // Same rule as an unreadable key: without require-persistent-keys the start continues with
        // a generated pair (WARN), and that pair signs tokens its own decoder accepts.
        SecurityConfig config = createConfig("admin", "pass", b64(rsa().getPrivate()), b64(rsa().getPublic()));

        var jwk = (com.nimbusds.jose.jwk.RSAKey) config.jwkSource()
                .get(
                        new com.nimbusds.jose.jwk.JWKSelector(new com.nimbusds.jose.jwk.JWKMatcher.Builder().build()),
                        null)
                .get(0);
        SecurityConfig.requireUsableKeyPair(jwk.toRSAPrivateKey(), jwk.toRSAPublicKey());
    }

    @Test
    void aMatchingPairPassesAndSignsATokenItsDecoderAccepts() throws Exception {
        KeyPair pair = rsa();
        SecurityConfig.requireUsableKeyPair(
                (java.security.interfaces.RSAPrivateKey) pair.getPrivate(),
                (java.security.interfaces.RSAPublicKey) pair.getPublic());

        SecurityConfig config = new SecurityConfig(
                "admin",
                "pass",
                new RsaKeyProperties(b64(pair.getPrivate()), b64(pair.getPublic()), true),
                new JwtProperties("taskflow", "taskflow-api", 3600),
                new CookieProperties(false));
        TokenProvider tokens = new TokenProvider(
                config.jwtEncoder(config.jwkSource()), new JwtProperties("taskflow", "taskflow-api", 3600));
        String token = tokens.generateToken(
                new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                        "admin",
                        "n/a",
                        java.util.List.of(
                                new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"))));

        AccountTokenCheck anyAccount = mock(AccountTokenCheck.class);
        RefreshSessionService anySession = mock(RefreshSessionService.class);
        when(anyAccount.validate(any()))
                .thenReturn(org.springframework.security.oauth2.core.OAuth2TokenValidatorResult.success());
        when(anySession.validate(any()))
                .thenReturn(org.springframework.security.oauth2.core.OAuth2TokenValidatorResult.success());
        assertEquals(
                "admin",
                config.jwtDecoder(new TokenRevocationList(), anyAccount, anySession)
                        .decode(token)
                        .getSubject());
    }

    @Test
    void aPrivateKeyThatDoesNotMatchItsOwnModulusFailsTheSignatureProbe() throws Exception {
        // Same modulus, wrong private exponent: the modulus comparison passes, the probe does not.
        KeyPair pair = rsa();
        java.security.interfaces.RSAPrivateKey real = (java.security.interfaces.RSAPrivateKey) pair.getPrivate();
        java.security.interfaces.RSAPrivateKey broken =
                (java.security.interfaces.RSAPrivateKey) java.security.KeyFactory.getInstance("RSA")
                        .generatePrivate(new java.security.spec.RSAPrivateKeySpec(
                                real.getModulus(), real.getPrivateExponent().add(java.math.BigInteger.TWO)));

        assertThrows(
                java.security.GeneralSecurityException.class,
                () -> SecurityConfig.requireUsableKeyPair(
                        broken, (java.security.interfaces.RSAPublicKey) pair.getPublic()));
    }

    @Test
    void testJwtDecoderException() throws Exception {
        SecurityConfig config = createConfig("admin", "pass", null, null);

        java.lang.reflect.Field rsaKeyField = SecurityConfig.class.getDeclaredField("rsaKey");
        rsaKeyField.setAccessible(true);
        rsaKeyField.set(config, null);

        assertThrows(
                IllegalStateException.class,
                () -> config.jwtDecoder(
                        new TokenRevocationList(), mock(AccountTokenCheck.class), mock(RefreshSessionService.class)));
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
    void aRefreshCookieIsAnAmbientCredentialButUnrelatedCookiesAreNot() {
        SecurityConfig config = createConfig("admin", "pass", null, null);
        MockHttpServletRequest withRefresh = new MockHttpServletRequest("POST", "/api/v1/auth/logout");
        withRefresh.addHeader("Authorization", "Bearer native-token");
        withRefresh.setCookies(new jakarta.servlet.http.Cookie("refresh_token", "r".repeat(43)));
        assertFalse(config.bearerOnlyRequestMatcher().matches(withRefresh));

        // A cookie a native HTTP stack picked up (or an analytics cookie) authenticates nothing.
        MockHttpServletRequest withOther = new MockHttpServletRequest("POST", "/api/v1/appointments/5");
        withOther.addHeader("Authorization", "Bearer native-token");
        withOther.setCookies(
                new jakarta.servlet.http.Cookie("XSRF-TOKEN", "x"), new jakarta.servlet.http.Cookie("theme", "dark"));
        assertTrue(config.bearerOnlyRequestMatcher().matches(withOther));
    }

    @Test
    void browserRefreshStaysCsrfProtectedEvenWithABearerHeader() {
        SecurityConfig config = createConfig("admin", "pass", null, null);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/refresh");
        request.setServletPath("/api/v1/auth/refresh");
        request.addHeader("Authorization", "Bearer native-token");

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

        config.initAdminUser(users, encoder, accounts).run();

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

        config.initAdminUser(users, encoder, accounts).run();

        verify(users).save(existing);
        assertTrue(encoder.matches("new-strong-pass", existing.getPasswordHash()));
        assertFalse(encoder.matches("admin-password", existing.getPasswordHash()));
        // tokens issued under the old password are revoked with it (#218)
        verify(accounts).revokeAllTokens("admin");
    }

    @Test
    void initAdminUser_leavesAMatchingPasswordAlone() throws Exception {
        SecurityConfig config = createConfig("admin", "same-pass", null, null);
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AppUser existing = new AppUser("admin", encoder.encode("same-pass"), "Shop Owner", "", "ROLE_ADMIN");
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmailIgnoreCase("admin")).thenReturn(Optional.of(existing));

        config.initAdminUser(users, encoder, accounts).run();

        verify(users, never()).save(any());
        verify(accounts, never()).revokeAllTokens(any());
    }

    @Test
    void initAdminUser_neverRewritesANonAdminAccountThatSharesTheName() throws Exception {
        SecurityConfig config = createConfig("admin", "whatever", null, null);
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AppUser customer = new AppUser("admin", encoder.encode("customer-chosen"), "Not Admin", "", "ROLE_CUSTOMER");
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmailIgnoreCase("admin")).thenReturn(Optional.of(customer));

        config.initAdminUser(users, encoder, accounts).run();

        verify(users, never()).save(any());
        assertTrue(encoder.matches("customer-chosen", customer.getPasswordHash()));
    }

    @Test
    void cookieSecureDefaultsToTrueInBothPlaces() throws Exception {
        // SecurityConfig and AuthController must agree on the fail-safe default: both read the one
        // CookieProperties record (no @Value of their own), whose default is Secure.
        assertTrue(java.util.List.of(SecurityConfig.class.getConstructors()[0].getParameterTypes())
                .contains(CookieProperties.class));
        assertTrue(java.util.List.of(AuthController.class.getConstructors()[0].getParameterTypes())
                .contains(CookieProperties.class));
        for (var p : SecurityConfig.class.getConstructors()[0].getParameters()) {
            var v = p.getAnnotation(org.springframework.beans.factory.annotation.Value.class);
            assertFalse(v != null && v.value().startsWith("${app.cookie.secure"), v == null ? "" : v.value());
        }
        assertTrue(new org.springframework.boot.context.properties.bind.Binder(
                        new org.springframework.boot.context.properties.source.MapConfigurationPropertySource())
                .bindOrCreate("app.cookie", CookieProperties.class)
                .secure());
    }
}
