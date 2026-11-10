package com.example.taskflow.auth;
import com.example.taskflow.auth.internal.UserRepository;

import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.csrf.CsrfToken;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthControllerTest {

    @Mock
    private AuthenticationManager authenticationManager;

    @Mock
    private TokenProvider tokenProvider;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private HttpServletResponse response;

    @Mock
    private RefreshSessionService refreshSessions;

    private static final String REFRESH = "r".repeat(43);

    private AuthController authController;
    private LoginAttemptLimiter loginAttemptLimiter;
    private TokenRevocationList tokenRevocationList;

    @BeforeEach
    void setUp() {
        loginAttemptLimiter = new LoginAttemptLimiter(3, 300);
        tokenRevocationList = new TokenRevocationList();
        authController = new AuthController(authenticationManager, tokenProvider, userRepository,
                passwordEncoder, loginAttemptLimiter, tokenRevocationList, new CookieProperties(false),
                refreshSessions);
    }

    /** The session family a login creates; its access token names it. */
    private void givenSession(Authentication authentication, String username, String role, String jwt) {
        when(refreshSessions.create(authentication)).thenReturn(new RefreshSessionService.Issued(
                "sid-1", username, role, 0, REFRESH, java.time.Instant.now().plusSeconds(3600)));
        when(tokenProvider.generateToken(authentication, "sid-1", 0)).thenReturn(jwt);
    }

    @Test
    void authenticateUser_shouldReturnLoginResponseAndSetCookie() {
        LoginRequest loginRequest = new LoginRequest("admin@test.com", "password");

        Authentication authentication = mock(Authentication.class);
        when(authenticationManager.authenticate(any(UsernamePasswordAuthenticationToken.class)))
                .thenReturn(authentication);
        when(authentication.getName()).thenReturn("admin@test.com");
        GrantedAuthority authority = () -> "ROLE_ADMIN";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority));
        givenSession(authentication, "admin@test.com", "ROLE_ADMIN", "jwt-token");

        ResponseEntity<LoginResponse> result = authController.authenticateUser(loginRequest, response);

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals("admin@test.com", result.getBody().username());
        assertEquals("ROLE_ADMIN", result.getBody().role());
        // The access cookie, the refresh cookie scoped to the auth endpoints, and the readable hint.
        ArgumentCaptor<String> headerValue = ArgumentCaptor.forClass(String.class);
        verify(response, times(3)).addHeader(eq("Set-Cookie"), headerValue.capture());
        assertTrue(headerValue.getAllValues().get(0).startsWith("access_token=jwt-token"));
        String refreshCookie = headerValue.getAllValues().get(1);
        assertTrue(refreshCookie.startsWith("refresh_token=" + REFRESH));
        assertTrue(refreshCookie.contains("Path=/api/v1/auth") && refreshCookie.contains("HttpOnly")
                && refreshCookie.contains("SameSite=Strict"));
        String hint = headerValue.getAllValues().get(2);
        assertTrue(hint.startsWith("taskflow_session=1") && hint.contains("Path=/") && !hint.contains("HttpOnly"),
                "the hint carries no credential and must be readable by the SPA");
    }

    @Test
    void authenticateMobileUser_shouldReturnBearerResponseWithoutCookie() {
        LoginRequest loginRequest = new LoginRequest("admin@test.com", "password");

        Authentication authentication = mock(Authentication.class);
        when(authenticationManager.authenticate(any(UsernamePasswordAuthenticationToken.class)))
                .thenReturn(authentication);
        when(authentication.getName()).thenReturn("admin@test.com");
        GrantedAuthority authority = () -> "ROLE_ADMIN";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority));
        givenSession(authentication, "admin@test.com", "ROLE_ADMIN", "mobile-jwt");
        when(tokenProvider.getTokenLifetimeSeconds()).thenReturn(3600L);

        ResponseEntity<MobileLoginResponse> result = authController.authenticateMobileUser(loginRequest);

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals("mobile-jwt", result.getBody().accessToken());
        assertEquals("Bearer", result.getBody().tokenType());
        assertEquals(3600L, result.getBody().expiresIn());
        assertEquals("admin@test.com", result.getBody().username());
        assertEquals("ROLE_ADMIN", result.getBody().role());
        assertEquals(REFRESH, result.getBody().refreshToken());
        verify(response, never()).addHeader(eq("Set-Cookie"), anyString());
    }

    @Test
    void refresh_rejectsAnUnknownOrRevokedCredentialWith401AndDropsTheBrowserCookies() {
        when(refreshSessions.rotate(REFRESH)).thenReturn(Optional.empty());

        assertThrows(org.springframework.security.authentication.BadCredentialsException.class,
                () -> authController.refreshMobile(new RefreshRequest(REFRESH)));
        verify(response, never()).addHeader(eq("Set-Cookie"), anyString());

        assertThrows(org.springframework.security.authentication.BadCredentialsException.class,
                () -> authController.refresh(REFRESH, response));
        ArgumentCaptor<String> headerValue = ArgumentCaptor.forClass(String.class);
        verify(response, times(2)).addHeader(eq("Set-Cookie"), headerValue.capture());
        assertTrue(headerValue.getAllValues().stream().anyMatch(v -> v.startsWith("refresh_token=;") && v.contains("Max-Age=0")));
        assertTrue(headerValue.getAllValues().stream().anyMatch(v -> v.startsWith("taskflow_session=;") && v.contains("Max-Age=0")),
                "a dead session must stop the SPA from renewing");
    }

    @Test
    void logout_revokesTheRefreshCredentialsItIsGivenAndClearsTheCookies() {
        ResponseEntity<Void> result = authController.logout(null, REFRESH, new RefreshRequest("m".repeat(43)), response);

        assertEquals(HttpStatus.NO_CONTENT, result.getStatusCode());
        verify(refreshSessions).revoke(REFRESH);
        verify(refreshSessions).revoke("m".repeat(43));
        ArgumentCaptor<String> headerValue = ArgumentCaptor.forClass(String.class);
        verify(response, times(3)).addHeader(eq("Set-Cookie"), headerValue.capture());
        for (String name : List.of("refresh_token", "taskflow_session", "access_token")) {
            assertTrue(headerValue.getAllValues().stream().anyMatch(v -> v.startsWith(name + "=;") && v.contains("Max-Age=0")),
                    name + " must be cleared");
        }
    }

    @Test
    void registerUser_shouldCreateAccount() {
        RegisterRequest request = new RegisterRequest("New User", "new@test.com", "password123", "555-1234");
        when(userRepository.findByEmailIgnoreCase("new@test.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode("password123")).thenReturn("encoded-password");

        ResponseEntity<RegisterResponse> result = authController.registerUser(request);

        assertEquals(HttpStatus.CREATED, result.getStatusCode());
        assertEquals("Account created successfully.", result.getBody().message());
        verify(userRepository).save(any(AppUser.class));
    }

    @Test
    void registerUser_shouldRejectDuplicateEmail() {
        RegisterRequest request = new RegisterRequest("Existing", "exists@test.com", "password123", null);
        when(userRepository.findByEmailIgnoreCase("exists@test.com"))
                .thenReturn(Optional.of(new AppUser()));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> authController.registerUser(request));
        assertEquals("Email is already registered.", ex.getMessage());
        verify(userRepository, never()).save(any());
    }

    @Test
    void currentUser_shouldReturnRoleWhenAuthenticated() {
        Authentication authentication = mock(Authentication.class);
        when(authentication.isAuthenticated()).thenReturn(true);
        when(authentication.getName()).thenReturn("user@test.com");
        GrantedAuthority authority = () -> "ROLE_CUSTOMER";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority));

        // We need SecurityContextHolder to have our mock - use a separate test approach
        try (var ctx = mockStatic(org.springframework.security.core.context.SecurityContextHolder.class)) {
            var securityContext = mock(org.springframework.security.core.context.SecurityContext.class);
            ctx.when(org.springframework.security.core.context.SecurityContextHolder::getContext)
                    .thenReturn(securityContext);
            when(securityContext.getAuthentication()).thenReturn(authentication);

            ResponseEntity<LoginResponse> result = authController.currentUser();

            assertEquals(HttpStatus.OK, result.getStatusCode());
            assertEquals("user@test.com", result.getBody().username());
            assertEquals("ROLE_CUSTOMER", result.getBody().role());
        }
    }

    @Test
    void currentUser_shouldReturn401WhenAnonymous() {
        try (var ctx = mockStatic(org.springframework.security.core.context.SecurityContextHolder.class)) {
            var securityContext = mock(org.springframework.security.core.context.SecurityContext.class);
            ctx.when(org.springframework.security.core.context.SecurityContextHolder::getContext)
                    .thenReturn(securityContext);
            Authentication authentication = mock(Authentication.class);
            when(securityContext.getAuthentication()).thenReturn(authentication);
            when(authentication.isAuthenticated()).thenReturn(true);
            when(authentication.getName()).thenReturn("anonymousUser");

            ResponseEntity<LoginResponse> result = authController.currentUser();

            assertEquals(HttpStatus.UNAUTHORIZED, result.getStatusCode());
            assertNull(result.getBody());
        }
    }

    @Test
    void logout_shouldClearCookie() {
        ResponseEntity<Void> result = authController.logout(null, null, null, response);

        assertEquals(HttpStatus.NO_CONTENT, result.getStatusCode());
        ArgumentCaptor<String> headerValue = ArgumentCaptor.forClass(String.class);
        verify(response, times(3)).addHeader(eq("Set-Cookie"), headerValue.capture());
        String access = headerValue.getAllValues().get(2);
        assertTrue(access.contains("access_token="));
        assertTrue(access.contains("Max-Age=0"));
    }

    @Test
    void csrf_shouldReturnToken() {
        CsrfToken token = mock(CsrfToken.class);
        when(token.getToken()).thenReturn("csrf-value");

        CsrfToken result = authController.csrf(token);

        assertEquals("csrf-value", result.getToken());
    }

    @Test
    void login_isThrottledPerAccountAfterRepeatedFailures() {
        LoginRequest bad = new LoginRequest("victim@test.com", "wrong");
        when(authenticationManager.authenticate(any(UsernamePasswordAuthenticationToken.class)))
                .thenThrow(new org.springframework.security.authentication.BadCredentialsException("bad"));

        for (int i = 0; i < 3; i++) {
            assertThrows(org.springframework.security.authentication.BadCredentialsException.class,
                    () -> authController.authenticateUser(bad, response));
        }

        // Fourth attempt is refused before the password is even checked.
        TooManyLoginAttemptsException ex = assertThrows(TooManyLoginAttemptsException.class,
                () -> authController.authenticateUser(bad, response));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, ex.getStatusCode());
        assertNotNull(ex.getHeaders().getFirst("Retry-After"));
        verify(authenticationManager, times(3)).authenticate(any());

        // Same account, different casing/whitespace, is the same throttle key; the
        // mobile endpoint shares it.
        assertThrows(TooManyLoginAttemptsException.class,
                () -> authController.authenticateMobileUser(new LoginRequest("  VICTIM@test.com ", "x")));

        // A different account is unaffected.
        assertThrows(org.springframework.security.authentication.BadCredentialsException.class,
                () -> authController.authenticateUser(new LoginRequest("other@test.com", "wrong"), response));
    }

    @Test
    void login_successClearsFailureCount() {
        LoginRequest request = new LoginRequest("user@test.com", "pw");
        Authentication authentication = mock(Authentication.class);
        when(authentication.getName()).thenReturn("user@test.com");
        GrantedAuthority authority = () -> "ROLE_CUSTOMER";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority));
        givenSession(authentication, "user@test.com", "ROLE_CUSTOMER", "jwt");
        when(authenticationManager.authenticate(any(UsernamePasswordAuthenticationToken.class)))
                .thenThrow(new org.springframework.security.authentication.BadCredentialsException("bad"))
                .thenThrow(new org.springframework.security.authentication.BadCredentialsException("bad"))
                .thenReturn(authentication);

        assertThrows(org.springframework.security.authentication.BadCredentialsException.class,
                () -> authController.authenticateUser(request, response));
        assertThrows(org.springframework.security.authentication.BadCredentialsException.class,
                () -> authController.authenticateUser(request, response));
        assertEquals(HttpStatus.OK, authController.authenticateUser(request, response).getStatusCode());

        // Counter was reset by the success, so three more failures are allowed again.
        assertDoesNotThrow(() -> loginAttemptLimiter.checkAllowed("user@test.com"));
    }

    @Test
    void nonCredentialFailuresAreNotCountedAgainstTheAccount() {
        when(authenticationManager.authenticate(any(UsernamePasswordAuthenticationToken.class)))
                .thenThrow(new IllegalStateException("database down"))
                .thenThrow(new org.springframework.security.authentication.InternalAuthenticationServiceException(
                        "Unable to query user", new org.springframework.dao.DataAccessResourceFailureException("pool exhausted")));
        LoginRequest request = new LoginRequest("user@test.com", "pw");

        assertThrows(IllegalStateException.class, () -> authController.authenticateUser(request, response));
        for (int i = 0; i < 5; i++) {
            assertThrows(org.springframework.security.authentication.InternalAuthenticationServiceException.class,
                    () -> authController.authenticateUser(request, response));
        }
        assertDoesNotThrow(() -> loginAttemptLimiter.checkAllowed("user@test.com"));
    }

    @Test
    void registerUser_normalisesEmailBeforeCheckingAndStoring() {
        RegisterRequest request = new RegisterRequest("New User", "  New@Test.COM ", "password123", "555");
        when(userRepository.findByEmailIgnoreCase("new@test.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode("password123")).thenReturn("encoded");

        ResponseEntity<RegisterResponse> result = authController.registerUser(request);

        assertEquals(HttpStatus.CREATED, result.getStatusCode());
        ArgumentCaptor<AppUser> saved = ArgumentCaptor.forClass(AppUser.class);
        verify(userRepository).save(saved.capture());
        assertEquals("new@test.com", saved.getValue().getEmail());
    }

    @Test
    void providerServiceFailuresAreNotCountedAsBadPasswordsOnEitherLoginRoute() {
        when(authenticationManager.authenticate(any()))
                .thenThrow(new org.springframework.security.authentication.AuthenticationServiceException("provider configuration"));
        LoginRequest request = new LoginRequest("user@test.com", "password");
        for (int i = 0; i < 5; i++) {
            assertThrows(org.springframework.security.authentication.AuthenticationServiceException.class,
                    () -> authController.authenticateUser(request, response));
            assertThrows(org.springframework.security.authentication.AuthenticationServiceException.class,
                    () -> authController.authenticateMobileUser(request));
        }
        assertDoesNotThrow(() -> loginAttemptLimiter.checkAllowed(request.username()));
        verifyNoInteractions(refreshSessions);
    }

    @Test
    void registerUser_losingTheUniqueConstraintRaceAnswersLikeTheDuplicateCheck() {
        RegisterRequest request = new RegisterRequest("Racer", "race@test.com", "password123", null);
        when(userRepository.findByEmailIgnoreCase("race@test.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode("password123")).thenReturn("encoded");
        when(userRepository.save(any(AppUser.class)))
                .thenThrow(new org.springframework.dao.DataIntegrityViolationException("duplicate key",
                        new java.sql.SQLException("duplicate key value", "23505")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> authController.registerUser(request));
        assertEquals("Email is already registered.", ex.getMessage());
    }

    /** A value too long for its column (22001) is not a duplicate and must not say so. */
    @Test
    void registerUser_otherIntegrityViolationsAreNotReportedAsDuplicates() {
        RegisterRequest request = new RegisterRequest("Long", "long@test.com", "password123", null);
        when(userRepository.findByEmailIgnoreCase("long@test.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode("password123")).thenReturn("encoded");
        org.springframework.dao.DataIntegrityViolationException tooLong =
                new org.springframework.dao.DataIntegrityViolationException("too long",
                        new java.sql.SQLException("value too long", "22001"));
        when(userRepository.save(any(AppUser.class))).thenThrow(tooLong);

        assertSame(tooLong, assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> authController.registerUser(request)));
    }

    @Test
    void registerRequest_rejectsAnEmailLongerThanTheBookingEmailLimit() {
        String email = "a".repeat(60) + "@" + "b".repeat(36) + ".com"; // 101 characters, otherwise a valid address
        try (var factory = jakarta.validation.Validation.buildDefaultValidatorFactory()) {
            var violations = factory.getValidator()
                    .validate(new RegisterRequest("Jane", email, "password123", "555"));
            assertEquals(1, violations.size());
            assertEquals("email", violations.iterator().next().getPropertyPath().toString());
        }
    }

    @Test
    void registerRequest_enforces72Utf8BytePasswordLimitForBcrypt() {
        try (var factory = jakarta.validation.Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            // 72 ASCII bytes passes
            assertTrue(validator.validate(new RegisterRequest("Jane", "j@x.com", "a1" + "b".repeat(70), "555")).isEmpty());
            // 73 ASCII bytes fails
            var ascii73 = validator.validate(new RegisterRequest("Jane", "j@x.com", "a1" + "b".repeat(71), "555"));
            assertEquals(1, ascii73.size());
            assertEquals("Password must not exceed 72 UTF-8 bytes", ascii73.iterator().next().getMessage());
            // 72 UTF-8 bytes using multibyte characters (2 + 35*2 = 72 bytes, 37 chars) passes
            assertTrue(validator.validate(new RegisterRequest("Jane", "j@x.com", "a1" + "é".repeat(35), "555")).isEmpty());
            // 73 UTF-8 bytes using multibyte characters (38 chars, 73 bytes) fails before BCrypt throws
            var utf8_73 = validator.validate(new RegisterRequest("Jane", "j@x.com", "a1" + "é".repeat(35) + "x", "555"));
            assertEquals(1, utf8_73.size());
            assertEquals("Password must not exceed 72 UTF-8 bytes", utf8_73.iterator().next().getMessage());
            for (String password : List.of("a1x" + "界".repeat(23), "a1xx" + "😀".repeat(17))) {
                assertTrue(validator.validate(new RegisterRequest("Jane", "j@x.com", password, "555")).isEmpty());
            }
            for (String password : List.of("a1xx" + "界".repeat(23), "a1xxx" + "😀".repeat(17),
                    "abc12345\uD800", "abc12345\uDC00")) {
                assertFalse(validator.validate(new RegisterRequest("Jane", "j@x.com", password, "555")).isEmpty());
            }
        }
    }

    @Test
    void logout_revokesThePresentedToken() {
        java.time.Instant now = java.time.Instant.now();
        org.springframework.security.oauth2.jwt.Jwt jwt = org.springframework.security.oauth2.jwt.Jwt
                .withTokenValue("tok").header("alg", "RS256").jti("jti-1")
                .issuedAt(now).expiresAt(now.plusSeconds(600)).subject("u@test.com")
                .claim(RefreshSessionService.SESSION_CLAIM, "sid-9").build();
        var authentication = new org.springframework.security.oauth2.server.resource.authentication
                .JwtAuthenticationToken(jwt);

        authController.logout(authentication, null, null, response);

        assertTrue(tokenRevocationList.isRevoked("jti-1"));
        assertFalse(tokenRevocationList.isRevoked("some-other-token"));
        // The token's whole session family ends with it.
        verify(refreshSessions).revokeSession("sid-9");
    }
}
