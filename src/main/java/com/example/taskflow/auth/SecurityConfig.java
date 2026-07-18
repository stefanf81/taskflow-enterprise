package com.example.taskflow.auth;

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
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
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
import java.util.Arrays;
import java.util.Collections;
import java.util.UUID;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private static final Logger logger = LoggerFactory.getLogger(SecurityConfig.class);

    private final String adminUsername;
    private final String adminPassword;
    private final String allowedOrigins;
    private final KeyPair keyPair;
    private final RSAKey rsaKey;
    private final DataSource dataSource;
    private final String jwtIssuer;
    private final String jwtAudience;

    public SecurityConfig(
            @Value("${spring.security.user.name:admin}") String adminUsername,
            @Value("${spring.security.user.password}") String adminPassword,
            @Value("${app.cors.allowed-origins:*}") String allowedOrigins,
            @Value("${app.rsa.private-key:#{null}}") String privateKeyB64,
            @Value("${app.rsa.public-key:#{null}}") String publicKeyB64,
            @Value("${app.jwt.issuer:taskflow}") String jwtIssuer,
            @Value("${app.jwt.audience:taskflow-api}") String jwtAudience,
            DataSource dataSource) {
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.allowedOrigins = allowedOrigins;
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
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/auth/register"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/appointments"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.PUT, "/api/v1/appointments/public/cancel/*"),
                    PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/v1/reviews/public/**")
                )
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
            )
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/login", "/api/v1/auth/register").permitAll()
                .requestMatchers("/actuator/health/**", "/actuator/prometheus").permitAll()
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/public/busy-slots").permitAll()
                .requestMatchers(HttpMethod.PUT, "/api/v1/appointments/public/cancel/*").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/appointments").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/catalog", "/api/v1/catalog/**").permitAll()
                .requestMatchers("/api/v1/reviews/public/**").permitAll()
                // Strict Admin restrictions to prevent privilege escalation / BOLA / PII leakage
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/{id}").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/v1/appointments/{id}").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/v1/appointments/{id}").hasRole("ADMIN")
                .requestMatchers("/api/v1/barbers/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/v1/catalog/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/v1/catalog/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/v1/catalog/**").hasRole("ADMIN")
                .requestMatchers("/api/v1/notifications/**").hasRole("ADMIN")
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

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        
        if ("*".equals(allowedOrigins)) {
            configuration.setAllowedOriginPatterns(Collections.singletonList("*"));
            configuration.setAllowCredentials(false);
        } else {
            configuration.setAllowedOrigins(Arrays.asList(allowedOrigins.split(",")));
            configuration.setAllowCredentials(true);
        }

        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Collections.singletonList("*"));
        configuration.setExposedHeaders(Collections.singletonList("Authorization"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

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
            logger.warn("Generated ephemeral RSA key pair (keys will be lost on restart). Set APP_RSA_PRIVATE_KEY and APP_RSA_PUBLIC_KEY env vars for persistence.");
            return kp;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to generate RSA key pair", e);
        }
    }
}
