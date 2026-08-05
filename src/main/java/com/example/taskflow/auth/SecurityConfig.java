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
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
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
public class SecurityConfig {

    private static final Logger logger = LoggerFactory.getLogger(SecurityConfig.class);

    private final String adminUsername;
    private final String adminPassword;
    private final KeyPair keyPair;
    private final RSAKey rsaKey;
    private final DataSource dataSource;
    private final String jwtIssuer;
    private final String jwtAudience;

    public SecurityConfig(
            @Value("${spring.security.user.name:admin}") String adminUsername,
            @Value("${spring.security.user.password}") String adminPassword,
            @Value("${app.rsa.private-key:#{null}}") String privateKeyB64,
            @Value("${app.rsa.public-key:#{null}}") String publicKeyB64,
            @Value("${app.jwt.issuer:taskflow}") String jwtIssuer,
            @Value("${app.jwt.audience:taskflow-api}") String jwtAudience,
            DataSource dataSource) {
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.dataSource = dataSource;
        this.jwtIssuer = jwtIssuer;
        this.jwtAudience = jwtAudience;
        this.keyPair = loadOrGenerateRsaKeyPair(privateKeyB64, publicKeyB64);
        this.rsaKey = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
                .privateKey((RSAPrivateKey) keyPair.getPrivate())
                .keyID(UUID.randomUUID().toString())
                .build();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
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
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
            )
            .cors(cors -> {})  // CorsConfigurationSource is provided by CorsConfig @Bean auto-detection
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
                // Swagger UI / OpenAPI docs are ADMIN-gated (fail-safe: even if
                // springdoc is left enabled, the docs are never public). Prod
                // additionally disables springdoc outright via
                // application-prod.properties.
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").hasRole("ADMIN")
                .requestMatchers("/h2-console/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/login", "/api/v1/auth/mobile/login", "/api/v1/auth/register").permitAll()
                // Liveness/readiness probes must stay reachable unauthenticated
                // for Kubernetes/docker healthchecks. Prometheus metrics reveal
                // operational data (paths, status distributions, cardinal tags),
                // so they require ADMIN. Defense-in-depth: prod runs actuator
                // behind an internal-only binding (deployment follow-up) so even
                // the ADMIN token is not externally scrapeable.
                .requestMatchers("/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                .requestMatchers("/actuator/prometheus").hasRole("ADMIN")
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/public/busy-slots").permitAll()
                .requestMatchers(HttpMethod.PUT, "/api/v1/appointments/public/cancel/*").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/appointments").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/catalog", "/api/v1/catalog/**").permitAll()
                .requestMatchers("/api/v1/reviews/public/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/barbers", "/api/v1/barbers/**").permitAll()
                // Strict Admin restrictions to prevent privilege escalation / BOLA / PII leakage
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/{id}").hasRole("ADMIN")
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
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .bearerTokenResolver(cookieBearerTokenResolver())
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)))
            .headers(headers -> headers
                .frameOptions(frame -> frame.sameOrigin())
                .addHeaderWriter(new org.springframework.security.web.header.writers.StaticHeadersWriter("Cross-Origin-Resource-Policy", "same-origin"))
            );

        return http.build();
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
            if (userRepository.findByEmailIgnoreCase(adminUsername).isEmpty()) {
                AppUser admin = new AppUser(
                    adminUsername,
                    passwordEncoder.encode(adminPassword),
                    "Shop Owner",
                    "",
                    "ROLE_ADMIN"
                );
                userRepository.save(admin);
                logger.info("Default admin user created successfully.");
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
    public JwtDecoder jwtDecoder() {
        try {
            NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(this.rsaKey.toRSAPublicKey()).build();
            // A3: validate issuer + audience (expiry is enforced by the default
            // validators). Rejects tokens issued by another authority or intended
            // for a different resource, closing token-substitution gaps.
            org.springframework.security.oauth2.core.OAuth2TokenValidator<org.springframework.security.oauth2.jwt.Jwt> audienceValidator =
                    new org.springframework.security.oauth2.jwt.JwtClaimValidator<List<String>>(
                            "aud", aud -> aud != null && aud.contains(jwtAudience));
            decoder.setJwtValidator(new org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator<>(
                    JwtValidators.createDefaultWithIssuer(jwtIssuer),
                    audienceValidator));
            return decoder;
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
    private static KeyPair loadOrGenerateRsaKeyPair(String privateKeyB64, String publicKeyB64) {
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
                logger.warn("Failed to load RSA keys from env vars, generating ephemeral keys: {}", e.getMessage());
            }
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
