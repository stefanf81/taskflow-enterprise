package com.example.taskflow.auth;
import com.example.taskflow.auth.internal.UserRepository;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.http.CacheControl;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.web.csrf.CsrfToken;

import java.time.Duration;
import java.util.Locale;

@RestController
@RequestMapping("/api/v1/auth")
@Tag(name = "Authentication Portal", description = "Endpoints for user authentication")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final TokenProvider tokenProvider;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final LoginAttemptLimiter loginAttemptLimiter;
    private final TokenRevocationList tokenRevocationList;
    private final boolean cookieSecure;

    public AuthController(AuthenticationManager authenticationManager, TokenProvider tokenProvider,
                          UserRepository userRepository, PasswordEncoder passwordEncoder,
                          LoginAttemptLimiter loginAttemptLimiter, TokenRevocationList tokenRevocationList,
                          @Value("${app.cookie.secure:true}") boolean cookieSecure) {
        this.authenticationManager = authenticationManager;
        this.tokenProvider = tokenProvider;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.loginAttemptLimiter = loginAttemptLimiter;
        this.tokenRevocationList = tokenRevocationList;
        this.cookieSecure = cookieSecure;
    }

    /**
     * Authenticates with per-account throttling: a username that has racked up
     * too many recent failures is refused (429) before any password check, and a
     * success clears its count. Only credential failures are counted — other
     * errors (e.g. the database being down) are not the caller's fault.
     */
    private Authentication authenticate(LoginRequest loginRequest) {
        loginAttemptLimiter.checkAllowed(loginRequest.username());
        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(loginRequest.username(), loginRequest.password()));
            loginAttemptLimiter.recordSuccess(loginRequest.username());
            return authentication;
        } catch (AuthenticationException e) {
            loginAttemptLimiter.recordFailure(loginRequest.username());
            throw e;
        }
    }

    @PostMapping("/login")
    @Operation(summary = "Authenticate user and issue an HttpOnly JWT cookie")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Login successful — JWT set in HttpOnly cookie"),
            @ApiResponse(responseCode = "401", description = "Invalid username or password")
    })
    public ResponseEntity<LoginResponse> authenticateUser(@Valid @RequestBody LoginRequest loginRequest,
                                                          HttpServletResponse response) {
        Authentication authentication = authenticate(loginRequest);

        String jwt = tokenProvider.generateToken(authentication);
        String role = extractRole(authentication);

        addAuthCookie(response, jwt);

        return ResponseEntity.ok(new LoginResponse(authentication.getName(), role));
    }

    @PostMapping("/mobile/login")
    @Operation(summary = "Authenticate a native client and issue a bearer token")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Login successful — bearer token returned"),
            @ApiResponse(responseCode = "401", description = "Invalid username or password")
    })
    public ResponseEntity<MobileLoginResponse> authenticateMobileUser(
            @Valid @RequestBody LoginRequest loginRequest) {
        Authentication authentication = authenticate(loginRequest);

        MobileLoginResponse response = new MobileLoginResponse(
                tokenProvider.generateToken(authentication),
                "Bearer",
                tokenProvider.getTokenLifetimeSeconds(),
                authentication.getName(),
                extractRole(authentication)
        );

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping("/register")
    @Operation(summary = "Register a new customer account")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Account created successfully"),
            @ApiResponse(responseCode = "400", description = "Email already registered or invalid input")
    })
    public ResponseEntity<RegisterResponse> registerUser(@Valid @RequestBody RegisterRequest request) {
        // Normalise once and use the same value for the duplicate check and the
        // insert. Checking the raw input but storing the trimmed/lower-cased form
        // let " A@x.com " pass the check and then collide with "a@x.com" (500).
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        if (userRepository.findByEmailIgnoreCase(email).isPresent()) {
            return emailAlreadyRegistered();
        }

        AppUser user = new AppUser(
            email,
            passwordEncoder.encode(request.password()),
            request.fullName(),
            request.phone(),
            "ROLE_CUSTOMER"
        );
        try {
            userRepository.save(user);
        } catch (DataIntegrityViolationException e) {
            // Two concurrent registrations both passed the check above; the unique
            // constraint on email picked the winner. Answer the loser exactly like
            // the pre-check does instead of leaking a 500.
            return emailAlreadyRegistered();
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(new RegisterResponse("Account created successfully."));
    }

    private ResponseEntity<RegisterResponse> emailAlreadyRegistered() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new RegisterResponse("Email is already registered."));
    }

    @GetMapping("/csrf")
    @Operation(summary = "Get CSRF token for authenticated state-changing requests")
    @ApiResponse(responseCode = "200", description = "CSRF token returned (also set in XSRF-TOKEN cookie)")
    public CsrfToken csrf(@Parameter(hidden = true) CsrfToken token) {
        return token;
    }

    @GetMapping("/me")
    @Operation(summary = "Return the currently authenticated principal's role")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Authenticated user's role returned"),
            @ApiResponse(responseCode = "401", description = "No valid cookie or bearer token present")
    })
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
    @ApiResponse(responseCode = "204", description = "JWT cookie cleared — session ended")
    public ResponseEntity<Void> logout(@Parameter(hidden = true) Authentication authentication,
                                       HttpServletResponse response) {
        // Deny the presented token for the rest of its lifetime. Without this a
        // copied cookie or mobile bearer token stays usable for up to an hour
        // after the user "logged out". Anonymous callers (already expired) just
        // get the cookie cleared.
        if (authentication instanceof JwtAuthenticationToken jwtAuthentication) {
            tokenRevocationList.revoke(jwtAuthentication.getToken().getId(),
                    jwtAuthentication.getToken().getExpiresAt());
        }
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
                .maxAge(Duration.ofSeconds(tokenProvider.getTokenLifetimeSeconds()))
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
