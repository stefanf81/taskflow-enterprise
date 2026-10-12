package com.example.taskflow.auth;
import com.example.taskflow.auth.internal.UserRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;

import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import javax.sql.DataSource;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.List;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.UUID;

@Configuration
@EnableWebSecurity
// Defence in depth: the admin controllers also carry @PreAuthorize, so a URL
// rule that is missing a method (HEAD, PATCH, ...) cannot expose them on its own.
@EnableMethodSecurity
public class SecurityConfig {

    private static final Logger logger = LoggerFactory.getLogger(SecurityConfig.class);

    private final String adminUsername;
    private final String adminPassword;
    private final KeyPair keyPair;
    private final RSAKey rsaKey;
    private final DataSource dataSource;
    private final String jwtIssuer;
    private final String jwtAudience;
    private final boolean cookieSecure;

    public SecurityConfig(
            @Value("${spring.security.user.name:admin}") String adminUsername,
            @Value("${spring.security.user.password}") String adminPassword,
            @Value("${app.rsa.private-key:#{null}}") String privateKeyB64,
             @Value("${app.rsa.public-key:#{null}}") String publicKeyB64,
             @Value("${app.rsa.require-persistent-keys:false}") boolean requirePersistentKeys,
            @Value("${app.jwt.issuer:taskflow}") String jwtIssuer,
            @Value("${app.jwt.audience:taskflow-api}") String jwtAudience,
            @Value("${app.cookie.secure:true}") boolean cookieSecure,
            DataSource dataSource) {
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.dataSource = dataSource;
        this.jwtIssuer = jwtIssuer;
        this.jwtAudience = jwtAudience;
        this.cookieSecure = cookieSecure;
        this.keyPair = loadOrGenerateRsaKeyPair(privateKeyB64, publicKeyB64, requirePersistentKeys);
        this.rsaKey = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
                .privateKey((RSAPrivateKey) keyPair.getPrivate())
                .keyID(UUID.randomUUID().toString())
                .build();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtDecoder jwtDecoder) throws Exception {
        JwtGrantedAuthoritiesConverter grantedAuthoritiesConverter = new JwtGrantedAuthoritiesConverter();
        grantedAuthoritiesConverter.setAuthorityPrefix("");
        grantedAuthoritiesConverter.setAuthoritiesClaimName("scope");

        JwtAuthenticationConverter jwtAuthenticationConverter = new JwtAuthenticationConverter();
        jwtAuthenticationConverter.setJwtGrantedAuthoritiesConverter(grantedAuthoritiesConverter);

        http
            .csrf(csrf -> csrf
                // Only exempt truly public state-changing endpoints from CSRF.
                // Authenticated endpoints (including POST /api/v1/auth/logout and
                // admin POST/PUT/DELETE) retain CSRF protection.
                .ignoringRequestMatchers(
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/auth/login"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/auth/mobile/login"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/auth/register"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/appointments"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.PUT, "/api/v1/appointments/public/cancel/*"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/reviews/public/**"),
                    PathPatternRequestMatcher.pathPattern("/h2-console/**"),
                    bearerOnlyRequestMatcher()
                )
                .csrfTokenRepository(csrfTokenRepository())
                .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
            )
            .cors(cors -> {})  // CorsConfigurationSource is provided by CorsConfig @Bean auto-detection
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Rules are listed per HTTP method, and Spring MVC serves HEAD from
                // every @GetMapping handler. Each GET rule therefore has a HEAD twin,
                // so HEAD can neither slip past an admin rule nor be refused on a
                // public one. Anything not listed is denied (see the last rule).
                .requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
                .requestMatchers(HttpMethod.HEAD, "/api/v1/auth/csrf").permitAll()
                // Swagger UI / OpenAPI docs are ADMIN-gated (fail-safe: even if
                // springdoc is left enabled, the docs are never public). Prod
                // additionally disables springdoc outright via
                // application-prod.properties.
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").hasRole("ADMIN")
                .requestMatchers("/h2-console/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/login", "/api/v1/auth/mobile/login", "/api/v1/auth/register").permitAll()
                // Logout must work for everyone: with an expired session it is the
                // request that clears the cookie, so it cannot require authentication.
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/logout").permitAll()
                .requestMatchers("/api/v1/auth/me").authenticated()
                // Liveness/readiness probes must stay reachable unauthenticated
                // for Kubernetes/docker healthchecks. VictoriaMetrics scrapes
                // Prometheus metrics without application credentials; production
                // NetworkPolicy restricts this port to the monitoring namespace.
                // All other Actuator endpoints remain administrator-only.
                .requestMatchers("/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                .requestMatchers(HttpMethod.GET, "/actuator/prometheus").permitAll()
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/public/busy-slots").permitAll()
                .requestMatchers(HttpMethod.HEAD, "/api/v1/appointments/public/busy-slots").permitAll()
                .requestMatchers(HttpMethod.PUT, "/api/v1/appointments/public/cancel/*").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/appointments").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/catalog", "/api/v1/catalog/**").permitAll()
                .requestMatchers(HttpMethod.HEAD, "/api/v1/catalog", "/api/v1/catalog/**").permitAll()
                .requestMatchers("/api/v1/reviews/public/**").permitAll()
                // Public booking only needs a barber identifier and display name.
                // Contact data and time-off details are restricted to administrators.
                .requestMatchers(HttpMethod.GET, "/api/v1/barbers").permitAll()
                .requestMatchers(HttpMethod.HEAD, "/api/v1/barbers").permitAll()
                // Strict Admin restrictions to prevent privilege escalation / BOLA / PII leakage.
                // GET and HEAD are both covered: HEAD reaches the same handler and would
                // otherwise leak existence/size (Content-Length) of admin-only data.
                .requestMatchers(HttpMethod.GET, "/api/v1/barbers/admin", "/api/v1/barbers/*/time-off").hasRole("ADMIN")
                .requestMatchers(HttpMethod.HEAD, "/api/v1/barbers/admin", "/api/v1/barbers/*/time-off").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/events").hasRole("ADMIN")
                .requestMatchers(HttpMethod.HEAD, "/api/v1/appointments/events").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments").hasRole("ADMIN")
                .requestMatchers(HttpMethod.HEAD, "/api/v1/appointments").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/{id}").hasRole("ADMIN")
                .requestMatchers(HttpMethod.HEAD, "/api/v1/appointments/{id}").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/v1/appointments/{id}").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/v1/appointments/{id}").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/v1/barbers/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/v1/barbers/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/v1/barbers/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/v1/catalog/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/v1/catalog/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/v1/catalog/**").hasRole("ADMIN")
                .requestMatchers("/api/v1/notifications/**").hasRole("ADMIN")
                .requestMatchers("/api/v1/customer/**").hasAnyRole("CUSTOMER", "ADMIN")
                // Deny by default. A new endpoint, or a method that no rule above
                // names, is refused until someone writes an explicit rule for it —
                // it must not silently become "any logged-in user".
                .anyRequest().denyAll()
            )
            // Registered ahead of CSRF/bearer processing so an invalid access_token
            // cookie is dropped (and expired) before it can turn every request,
            // including login and public pages, into a 401.
            .addFilterBefore(new StaleAccessTokenCookieFilter(jwtDecoder, cookieSecure), CsrfFilter.class)
            .oauth2ResourceServer(oauth2 -> oauth2
                .bearerTokenResolver(cookieBearerTokenResolver())
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)))
            .headers(headers -> headers
                .frameOptions(frame -> frame.sameOrigin())
                .addHeaderWriter(new org.springframework.security.web.header.writers.StaticHeadersWriter("Cross-Origin-Resource-Policy", "same-origin"))
            );

        return http.build();
    }

    CookieCsrfTokenRepository csrfTokenRepository() {
        CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieCustomizer(cookie -> cookie
                // Angular must read this double-submit token, unlike the auth cookie.
                .sameSite("Strict")
                .secure(cookieSecure));
        return repository;
    }

    /**
     * Resolves the OAuth2 bearer token from the HttpOnly {@code access_token} cookie
     * (C2 migration), falling back to the standard {@code Authorization: Bearer}
     * header. This lets the Angular SPA authenticate via the secure cookie without
     * ever exposing the JWT to JavaScript.
     */
    @Bean
    public BearerTokenResolver cookieBearerTokenResolver() {
        DefaultBearerTokenResolver headerResolver = new DefaultBearerTokenResolver();
        return request -> {
            jakarta.servlet.http.Cookie[] cookies = request.getCookies();
            if (cookies != null) {
                for (jakarta.servlet.http.Cookie cookie : cookies) {
                    if ("access_token".equals(cookie.getName())) {
                        String value = cookie.getValue();
                        return (value != null && !value.isBlank()) ? value : null;
                    }
                }
            }
            return headerResolver.resolve(request);
        };
    }

    /**
     * Native bearer requests do not carry ambient browser credentials and are
     * therefore not exposed to the CSRF threat model. Browser requests that
     * carry the HttpOnly access_token cookie remain protected, even if a
     * caller also supplies an Authorization header.
     */
    RequestMatcher bearerOnlyRequestMatcher() {
        return request -> {
            String authorization = request.getHeader("Authorization");
            if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
                return false;
            }

            jakarta.servlet.http.Cookie[] cookies = request.getCookies();
            if (cookies == null) {
                return true;
            }
            for (jakarta.servlet.http.Cookie cookie : cookies) {
                if ("access_token".equals(cookie.getName())
                        && cookie.getValue() != null
                        && !cookie.getValue().isBlank()) {
                    return false;
                }
            }
            return true;
        };
    }

    @Bean
    public AuthenticationManager authenticationManager(
            UserDetailsService userDetailsService,
            PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider authenticationProvider = new DaoAuthenticationProvider(userDetailsService);
        authenticationProvider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(authenticationProvider);
    }

    @Bean
    public org.springframework.boot.CommandLineRunner initAdminUser(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        return args -> {
            java.util.Optional<AppUser> existing = userRepository.findByEmailIgnoreCase(adminUsername);
            if (existing.isEmpty()) {
                AppUser admin = new AppUser(
                    adminUsername,
                    passwordEncoder.encode(adminPassword),
                    "Shop Owner",
                    "",
                    "ROLE_ADMIN"
                );
                userRepository.save(admin);
                logger.info("Default admin user created successfully.");
            } else if ("ROLE_ADMIN".equals(existing.get().getRole())
                    && !passwordEncoder.matches(adminPassword, existing.get().getPasswordHash())) {
                // The configured password is the source of truth for the admin
                // account. Without this, an admin created on a first boot with the
                // wrong/default value would keep that password forever, and setting
                // SPRING_SECURITY_PASSWORD afterwards would silently do nothing.
                AppUser admin = existing.get();
                admin.setPasswordHash(passwordEncoder.encode(adminPassword));
                userRepository.save(admin);
                logger.info("Admin password re-synchronised from configuration.");
            }
        };
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public JWKSource<SecurityContext> jwkSource() {
        JWKSet jwkSet = new JWKSet(this.rsaKey);
        return (jwkSelector, securityContext) -> jwkSelector.select(jwkSet);
    }

    @Bean
    public JwtEncoder jwtEncoder(JWKSource<SecurityContext> jwkSource) {
        return new NimbusJwtEncoder(jwkSource);
    }

    @Bean
    public JwtDecoder jwtDecoder(TokenRevocationList revocationList) {
        try {
            NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(this.rsaKey.toRSAPublicKey()).build();
            // A3: validate issuer + audience (expiry is enforced by the default
            // validators). Rejects tokens issued by another authority or intended
            // for a different resource, closing token-substitution gaps.
            org.springframework.security.oauth2.core.OAuth2TokenValidator<org.springframework.security.oauth2.jwt.Jwt> audienceValidator =
                    new org.springframework.security.oauth2.jwt.JwtClaimValidator<List<String>>(
                            "aud", aud -> aud != null && aud.contains(jwtAudience));
            // Tokens revoked at logout are rejected for the rest of their lifetime.
            OAuth2TokenValidator<Jwt> notRevoked = jwt -> revocationList.isRevoked(jwt.getId())
                    ? OAuth2TokenValidatorResult.failure(
                            new OAuth2Error("invalid_token", "The token has been revoked.", null))
                    : OAuth2TokenValidatorResult.success();
            decoder.setJwtValidator(new org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator<>(
                    JwtValidators.createDefaultWithIssuer(jwtIssuer),
                    audienceValidator,
                    notRevoked));
            // The stale-cookie filter and the bearer-token filter both decode the cookie's token;
            // within one request the second decode reuses the first (validated) result.
            return new RequestScopedJwtDecoder(decoder);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to configure RSA Public Key decoder", e);
        }
    }

    /**
     * Load a persistent RSA keypair from APP_RSA_PRIVATE_KEY / APP_RSA_PUBLIC_KEY
     * environment variables (base64-encoded DER). Falls back to a freshly generated
     * ephemeral key when the env vars are absent (logged at WARN — JWT tokens become
     * invalid on restart in this case).
     */
    private static KeyPair loadOrGenerateRsaKeyPair(
            String privateKeyB64, String publicKeyB64, boolean requirePersistentKeys) {
        if (privateKeyB64 != null && !privateKeyB64.isBlank() && 
            publicKeyB64 != null && !publicKeyB64.isBlank()) {
            try {
                byte[] privateBytes = java.util.Base64.getDecoder().decode(privateKeyB64);
                byte[] publicBytes = java.util.Base64.getDecoder().decode(publicKeyB64);
                
                java.security.spec.PKCS8EncodedKeySpec privateSpec = new java.security.spec.PKCS8EncodedKeySpec(privateBytes);
                java.security.spec.X509EncodedKeySpec publicSpec = new java.security.spec.X509EncodedKeySpec(publicBytes);
                
                java.security.KeyFactory keyFactory = java.security.KeyFactory.getInstance("RSA");
                RSAPrivateKey privateKey = (RSAPrivateKey) keyFactory.generatePrivate(privateSpec);
                RSAPublicKey publicKey = (RSAPublicKey) keyFactory.generatePublic(publicSpec);
                
                logger.info("Loaded persistent RSA key pair from environment variables");
                return new KeyPair(publicKey, privateKey);
            } catch (Exception e) {
                if (requirePersistentKeys) {
                    throw new IllegalStateException("Persistent RSA keys are required but could not be loaded", e);
                }
                logger.warn("Failed to load RSA keys from env vars, generating ephemeral keys: {}", e.getMessage());
            }
        }

        if (requirePersistentKeys) {
            throw new IllegalStateException("Persistent RSA keys are required in this environment");
        }
        
        try {
            KeyPairGenerator keyPairGenerator = KeyPairGenerator.getInstance("RSA");
            keyPairGenerator.initialize(2048);
            KeyPair kp = keyPairGenerator.generateKeyPair();
            logger.warn("*** EPHEMERAL RSA KEY IN USE *** All JWT tokens invalidated on restart. "
                    + "Set APP_RSA_PRIVATE_KEY and APP_RSA_PUBLIC_KEY env vars for persistent signing.");
            return kp;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to generate RSA key pair", e);
        }
    }
}
