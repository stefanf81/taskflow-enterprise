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

    private AuthController authController;
    private LoginAttemptLimiter loginAttemptLimiter;
    private TokenRevocationList tokenRevocationList;

    @BeforeEach
    void setUp() {
        loginAttemptLimiter = new LoginAttemptLimiter(3, 300);
        tokenRevocationList = new TokenRevocationList();
        authController = new AuthController(authenticationManager, tokenProvider, userRepository,
                passwordEncoder, loginAttemptLimiter, tokenRevocationList, false);
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
        when(tokenProvider.generateToken(authentication)).thenReturn("jwt-token");

        ResponseEntity<LoginResponse> result = authController.authenticateUser(loginRequest, response);

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals("admin@test.com", result.getBody().username());
        assertEquals("ROLE_ADMIN", result.getBody().role());
        // Verify cookie was set
        ArgumentCaptor<String> headerValue = ArgumentCaptor.forClass(String.class);
        verify(response).addHeader(eq("Set-Cookie"), headerValue.capture());
        assertTrue(headerValue.getValue().startsWith("access_token=jwt-token"));
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
        when(tokenProvider.generateToken(authentication)).thenReturn("mobile-jwt");
        when(tokenProvider.getTokenLifetimeSeconds()).thenReturn(3600L);

        ResponseEntity<MobileLoginResponse> result = authController.authenticateMobileUser(loginRequest);

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals("mobile-jwt", result.getBody().accessToken());
        assertEquals("Bearer", result.getBody().tokenType());
        assertEquals(3600L, result.getBody().expiresIn());
        assertEquals("admin@test.com", result.getBody().username());
        assertEquals("ROLE_ADMIN", result.getBody().role());
        verify(response, never()).addHeader(eq("Set-Cookie"), anyString());
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

        ResponseEntity<RegisterResponse> result = authController.registerUser(request);

        assertEquals(HttpStatus.BAD_REQUEST, result.getStatusCode());
        assertEquals("Email is already registered.", result.getBody().message());
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
        ResponseEntity<Void> result = authController.logout(null, response);

        assertEquals(HttpStatus.NO_CONTENT, result.getStatusCode());
        ArgumentCaptor<String> headerValue = ArgumentCaptor.forClass(String.class);
        verify(response).addHeader(eq("Set-Cookie"), headerValue.capture());
        assertTrue(headerValue.getValue().contains("access_token="));
        assertTrue(headerValue.getValue().contains("Max-Age=0"));
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
        when(tokenProvider.generateToken(authentication)).thenReturn("jwt");
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
                .thenThrow(new IllegalStateException("database down"));
        LoginRequest request = new LoginRequest("user@test.com", "pw");

        for (int i = 0; i < 5; i++) {
            assertThrows(IllegalStateException.class, () -> authController.authenticateUser(request, response));
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
    void registerUser_losingTheUniqueConstraintRaceAnswersLikeTheDuplicateCheck() {
        RegisterRequest request = new RegisterRequest("Racer", "race@test.com", "password123", null);
        when(userRepository.findByEmailIgnoreCase("race@test.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode("password123")).thenReturn("encoded");
        when(userRepository.save(any(AppUser.class)))
                .thenThrow(new org.springframework.dao.DataIntegrityViolationException("duplicate key"));

        ResponseEntity<RegisterResponse> result = authController.registerUser(request);

        assertEquals(HttpStatus.BAD_REQUEST, result.getStatusCode());
        assertEquals("Email is already registered.", result.getBody().message());
    }

    @Test
    void logout_revokesThePresentedToken() {
        java.time.Instant now = java.time.Instant.now();
        org.springframework.security.oauth2.jwt.Jwt jwt = org.springframework.security.oauth2.jwt.Jwt
                .withTokenValue("tok").header("alg", "RS256").jti("jti-1")
                .issuedAt(now).expiresAt(now.plusSeconds(600)).subject("u@test.com").build();
        var authentication = new org.springframework.security.oauth2.server.resource.authentication
                .JwtAuthenticationToken(jwt);

        authController.logout(authentication, response);

        assertTrue(tokenRevocationList.isRevoked("jti-1"));
        assertFalse(tokenRevocationList.isRevoked("some-other-token"));
    }
}
