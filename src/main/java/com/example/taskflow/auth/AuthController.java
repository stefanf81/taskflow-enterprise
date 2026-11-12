package com.example.taskflow.auth;
import com.example.taskflow.auth.internal.UserRepository;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.http.CacheControl;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.BadCredentialsException;
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
class AuthController {

    /** HttpOnly, path-scoped to /api/v1/auth: only renewal and logout ever receive it. */
    static final String REFRESH_COOKIE = "refresh_token";
    /** Readable by the SPA, no credential: tells it (and nginx) that this browser can renew. */
    static final String SESSION_HINT_COOKIE = "taskflow_session";

    private final AuthenticationManager authenticationManager;
    private final TokenProvider tokenProvider;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final LoginAttemptLimiter loginAttemptLimiter;
    private final TokenRevocationList tokenRevocationList;
    private final RefreshSessionService refreshSessions;
    private final boolean cookieSecure;

    public AuthController(AuthenticationManager authenticationManager, TokenProvider tokenProvider,
                          UserRepository userRepository, PasswordEncoder passwordEncoder,
                          LoginAttemptLimiter loginAttemptLimiter, TokenRevocationList tokenRevocationList,
                          CookieProperties cookieProperties, RefreshSessionService refreshSessions) {
        this.authenticationManager = authenticationManager;
        this.tokenProvider = tokenProvider;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.loginAttemptLimiter = loginAttemptLimiter;
        this.tokenRevocationList = tokenRevocationList;
        this.cookieSecure = cookieProperties.secure();
        this.refreshSessions = refreshSessions;
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
        } catch (AuthenticationServiceException e) {
            // A provider/system failure is not evidence of an incorrect password, even when
            // it is not the internal lookup failure that our advice exposes as retryable 503.
            throw e;
        } catch (AuthenticationException e) {
            loginAttemptLimiter.recordFailure(loginRequest.username());
            throw e;
        }
    }

    @PostMapping("/login")
    @Operation(summary = "Authenticate user and issue an HttpOnly JWT cookie")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Login successful — JWT set in HttpOnly cookie"),
            @ApiResponse(responseCode = "400", description = "Invalid login payload"),
            @ApiResponse(responseCode = "401", description = "Invalid username or password"),
            @ApiResponse(responseCode = "429", description = "Too many failed login attempts"),
            @ApiResponse(responseCode = "500", description = "Authentication service failure"),
            @ApiResponse(responseCode = "503", description = "Authentication service temporarily unavailable",
                    headers = @Header(name = "Retry-After", description = "Seconds before retrying",
                            schema = @Schema(type = "integer", example = "1")))
    })
    public ResponseEntity<LoginResponse> authenticateUser(@Valid @RequestBody LoginRequest loginRequest,
                                                          HttpServletResponse response) {
        Authentication authentication = authenticate(loginRequest);

        RefreshSessionService.Issued session = refreshSessions.create(authentication);
        String role = extractRole(authentication);

        addAuthCookie(response, issueAccessToken(authentication, session));
        addRefreshCookie(response, session);

        return ResponseEntity.ok(new LoginResponse(authentication.getName(), role));
    }

    @PostMapping("/mobile/login")
    @Operation(summary = "Authenticate a native client and issue a bearer token")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Login successful — bearer token returned"),
            @ApiResponse(responseCode = "400", description = "Invalid login payload"),
            @ApiResponse(responseCode = "401", description = "Invalid username or password"),
            @ApiResponse(responseCode = "429", description = "Too many failed login attempts"),
            @ApiResponse(responseCode = "500", description = "Authentication service failure"),
            @ApiResponse(responseCode = "503", description = "Authentication service temporarily unavailable",
                    headers = @Header(name = "Retry-After", description = "Seconds before retrying",
                            schema = @Schema(type = "integer", example = "1")))
    })
    public ResponseEntity<MobileLoginResponse> authenticateMobileUser(
            @Valid @RequestBody LoginRequest loginRequest) {
        Authentication authentication = authenticate(loginRequest);
        RefreshSessionService.Issued session = refreshSessions.create(authentication);

        MobileLoginResponse response = new MobileLoginResponse(
                issueAccessToken(authentication, session),
                "Bearer",
                tokenProvider.getTokenLifetimeSeconds(),
                authentication.getName(),
                extractRole(authentication),
                session.refreshToken()
        );

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping("/refresh")
    @Operation(summary = "Rotate the browser session credential (requires CSRF)")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Session renewed"),
            @ApiResponse(responseCode = "401", description = "Session expired or revoked"),
            @ApiResponse(responseCode = "403", description = "CSRF token missing or invalid")})
    public ResponseEntity<LoginResponse> refresh(
            @CookieValue(name = REFRESH_COOKIE, required = false) String secret,
            HttpServletResponse response) {
        java.util.Optional<RefreshSessionService.Issued> renewed = refreshSessions.rotate(secret);
        if (renewed.isEmpty()) {
            // A dead credential: drop it and the hint, so the SPA stops trying to renew.
            clearRefreshCookies(response);
            throw new BadCredentialsException("Session expired or revoked.");
        }
        RefreshSessionService.Issued session = renewed.get();
        addAuthCookie(response, issueAccessToken(session.authentication(), session));
        addRefreshCookie(response, session);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new LoginResponse(session.username(), session.role()));
    }

    @PostMapping("/mobile/refresh")
    @Operation(summary = "Rotate a native client's one-use refresh credential")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Session renewed"),
            @ApiResponse(responseCode = "400", description = "Invalid refresh payload"),
            @ApiResponse(responseCode = "401", description = "Session expired or revoked")})
    public ResponseEntity<MobileLoginResponse> refreshMobile(@Valid @RequestBody RefreshRequest request) {
        RefreshSessionService.Issued session = refreshSessions.rotate(request.refreshToken())
                .orElseThrow(() -> new BadCredentialsException("Session expired or revoked."));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new MobileLoginResponse(
                issueAccessToken(session.authentication(), session),
                "Bearer", tokenProvider.getTokenLifetimeSeconds(), session.username(), session.role(), session.refreshToken()));
    }

    /** Access tokens name their session family, so logout or reuse detection can revoke them. */
    private String issueAccessToken(Authentication authentication, RefreshSessionService.Issued session) {
        return tokenProvider.generateToken(authentication, session.id(), session.tokenVersion());
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
            throw emailAlreadyRegistered();
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
            // the pre-check does instead of leaking a 500. Any other integrity failure
            // (e.g. a value too long for its column) is not a duplicate: let it surface.
            if (isUniqueViolation(e)) {
                throw emailAlreadyRegistered();
            }
            throw e;
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(new RegisterResponse("Account created successfully."));
    }

    /** SQLSTATE 23505 (unique_violation, PostgreSQL and H2) anywhere in the cause chain. */
    private static boolean isUniqueViolation(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof java.sql.SQLException sql && "23505".equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private static IllegalArgumentException emailAlreadyRegistered() {
        return new IllegalArgumentException("Email is already registered.");
    }

    @GetMapping("/csrf")
    @Operation(summary = "Get CSRF token for authenticated state-changing requests")
    @ApiResponse(responseCode = "200", description = "CSRF token returned (also set in XSRF-TOKEN cookie)")
    public ResponseEntity<CsrfToken> csrf(@Parameter(hidden = true) CsrfToken token) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(token);
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
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .cacheControl(CacheControl.noStore())
                    .build();
        }
        String role = extractRole(authentication);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new LoginResponse(authentication.getName(), role));
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
    public ResponseEntity<Void> logout(@Parameter(hidden = true) @Nullable Authentication authentication,
                                       @CookieValue(name = REFRESH_COOKIE, required = false) String refreshCookie,
                                       @RequestBody(required = false) @Nullable RefreshRequest request,
                                       HttpServletResponse response) {
        // Deny the presented token for the rest of its lifetime. Without this a
        // copied cookie or mobile bearer token stays usable for up to an hour
        // after the user "logged out". Anonymous callers (already expired) still
        // revoke the refresh credential they present and get the cookies cleared.
        if (authentication instanceof JwtAuthenticationToken jwtAuthentication) {
            tokenRevocationList.revoke(jwtAuthentication.getToken().getId(),
                    jwtAuthentication.getToken().getExpiresAt());
            String sessionId = jwtAuthentication.getToken().getClaimAsString(RefreshSessionService.SESSION_CLAIM);
            if (sessionId != null) {
                refreshSessions.revokeSession(sessionId);
            }
        }
        refreshSessions.revoke(refreshCookie);
        if (request != null) {
            refreshSessions.revoke(request.refreshToken());
        }
        clearRefreshCookies(response);
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

    /**
     * The HttpOnly credential (only the auth endpoints receive it) plus a readable hint cookie
     * that carries nothing but "this browser can renew": the SPA cannot see the credential, and
     * without the hint every guest page load would probe the refresh endpoint.
     */
    private void addRefreshCookie(HttpServletResponse response, RefreshSessionService.Issued session) {
        Duration remaining = Duration.between(java.time.Instant.now(TokenProvider.TOKEN_CLOCK), session.expiresAt());
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(REFRESH_COOKIE, session.refreshToken())
                .httpOnly(true).secure(cookieSecure).sameSite("Strict").path("/api/v1/auth")
                .maxAge(remaining)
                .build().toString());
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(SESSION_HINT_COOKIE, "1")
                .httpOnly(false).secure(cookieSecure).sameSite("Strict").path("/")
                .maxAge(remaining)
                .build().toString());
    }

    private void clearRefreshCookies(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(REFRESH_COOKIE, "")
                .httpOnly(true).secure(cookieSecure).sameSite("Strict").path("/api/v1/auth").maxAge(0)
                .build().toString());
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(SESSION_HINT_COOKIE, "")
                .httpOnly(false).secure(cookieSecure).sameSite("Strict").path("/").maxAge(0)
                .build().toString());
    }
}
