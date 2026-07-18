package com.example.taskflow.auth;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/auth")
@CrossOrigin(origins = "${app.cors.allowed-origins:*}")
@Tag(name = "Authentication Portal", description = "Endpoints for user authentication")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final TokenProvider tokenProvider;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final boolean cookieSecure;

    public AuthController(AuthenticationManager authenticationManager, TokenProvider tokenProvider,
                          UserRepository userRepository, PasswordEncoder passwordEncoder,
                          @Value("${app.cookie.secure:true}") boolean cookieSecure) {
        this.authenticationManager = authenticationManager;
        this.tokenProvider = tokenProvider;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.cookieSecure = cookieSecure;
    }

    @PostMapping("/login")
    @Operation(summary = "Authenticate user and issue an HttpOnly JWT cookie")
    public ResponseEntity<LoginResponse> authenticateUser(@Valid @RequestBody LoginRequest loginRequest,
                                                          HttpServletResponse response) {
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(loginRequest.username(), loginRequest.password())
        );

        String jwt = tokenProvider.generateToken(authentication);
        String role = extractRole(authentication);

        addAuthCookie(response, jwt);

        return ResponseEntity.ok(new LoginResponse(authentication.getName(), role));
    }

    @PostMapping("/register")
    @Operation(summary = "Register a new customer account")
    public ResponseEntity<?> registerUser(@Valid @RequestBody RegisterRequest request) {
        if (userRepository.findByEmailIgnoreCase(request.email()).isPresent()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ErrorResponse("Email is already registered."));
        }

        AppUser user = new AppUser(
            request.email().toLowerCase().trim(),
            passwordEncoder.encode(request.password()),
            request.fullName(),
            request.phone(),
            "ROLE_CUSTOMER"
        );
        userRepository.save(user);

        return ResponseEntity.status(HttpStatus.CREATED).body(new ErrorResponse("Account created successfully."));
    }

    @GetMapping("/me")
    @Operation(summary = "Return the currently authenticated principal's role")
    public ResponseEntity<LoginResponse> currentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || "anonymousUser".equals(authentication.getName())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        String role = extractRole(authentication);
        return ResponseEntity.ok(new LoginResponse(authentication.getName(), role));
    }

    /**
     * The JWT {@code scope} claim carries both the real role (e.g. {@code ROLE_ADMIN})
     * and Spring Security's factory-default factor authorities (e.g.
     * {@code FACTOR_PASSWORD}). Always pick the {@code ROLE_*} authority so the UI
     * gets a stable, meaningful role.
     */
    private String extractRole(Authentication authentication) {
        return authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(authority -> authority.startsWith("ROLE_"))
                .findFirst()
                .or(() -> authentication.getAuthorities().stream()
                        .map(GrantedAuthority::getAuthority)
                        .findFirst())
                .orElse("ROLE_CUSTOMER");
    }

    @PostMapping("/logout")
    @Operation(summary = "Clear the HttpOnly JWT cookie")
    public ResponseEntity<Void> logout(HttpServletResponse response) {
        ResponseCookie cookie = ResponseCookie.from("access_token", "")
                .httpOnly(true)
                .secure(cookieSecure)
                .sameSite("Strict")
                .path("/")
                .maxAge(0)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        return ResponseEntity.noContent().build();
    }

    private void addAuthCookie(HttpServletResponse response, String jwt) {
        ResponseCookie cookie = ResponseCookie.from("access_token", jwt)
                .httpOnly(true)
                .secure(cookieSecure)
                .sameSite("Strict")
                .path("/")
                .maxAge(Duration.ofHours(1))
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    public record ErrorResponse(String message) {}
}
