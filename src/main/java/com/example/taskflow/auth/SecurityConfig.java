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
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityCustomizer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.JdbcUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.XContentTypeOptionsHeaderWriter;
import org.springframework.security.web.header.writers.frameoptions.XFrameOptionsHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;

import javax.sql.DataSource;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
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

    public SecurityConfig(
            @Value("${spring.security.user.name:admin}") String adminUsername,
            @Value("${spring.security.user.password}") String adminPassword,
            @Value("${app.cors.allowed-origins:*}") String allowedOrigins,
            @Value("${app.rsa.private-key:#{null}}") String privateKeyB64,
            @Value("${app.rsa.public-key:#{null}}") String publicKeyB64,
            DataSource dataSource) {
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.allowedOrigins = allowedOrigins;
        this.dataSource = dataSource;
        this.keyPair = loadOrGenerateRsaKeyPair(privateKeyB64, publicKeyB64);
        this.rsaKey = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
                .privateKey((RSAPrivateKey) keyPair.getPrivate())
                .keyID(UUID.randomUUID().toString())
                .build();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/api/v1/auth/**").permitAll()
                .requestMatchers("/actuator/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/appointments/public/busy-slots").permitAll()
                .requestMatchers(HttpMethod.PUT, "/api/v1/appointments/public/cancel/*").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/appointments").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/catalog").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
            .headers(headers -> headers
                .frameOptions(frame -> frame.sameOrigin())
            );

        return http.build();
    }

    @Bean
    public WebSecurityCustomizer webSecurityCustomizer() {
        return web -> web.ignoring()
                .requestMatchers("/v3/api-docs/**");
    }

    @Bean
    public AuthenticationManager authenticationManager(
            UserDetailsService userDetailsService,
            PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider authenticationProvider = new DaoAuthenticationProvider();
        authenticationProvider.setUserDetailsService(userDetailsService);
        authenticationProvider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(authenticationProvider);
    }

    @Bean
    public UserDetailsService userDetailsService() {
        UserDetails admin = User.withUsername(adminUsername)
            .password(passwordEncoder().encode(adminPassword))
            .roles("ADMIN")
            .build();
        return new org.springframework.security.provisioning.InMemoryUserDetailsManager(admin);
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
            return NimbusJwtDecoder.withPublicKey(this.rsaKey.toRSAPublicKey()).build();
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
