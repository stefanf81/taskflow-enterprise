package com.example.taskflow.auth;

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

    @BeforeEach
    void setUp() {
        authController = new AuthController(authenticationManager, tokenProvider, userRepository, passwordEncoder, false);
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
        ResponseEntity<Void> result = authController.logout(response);

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
}
