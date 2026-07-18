package com.example.taskflow.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.stream.Collectors;

@Component
public class TokenProvider {

    private final JwtEncoder encoder;
    private final String issuer;
    private final String audience;

    public TokenProvider(
            JwtEncoder encoder,
            @Value("${app.jwt.issuer:taskflow}") String issuer,
            @Value("${app.jwt.audience:taskflow-api}") String audience) {
        this.encoder = encoder;
        this.issuer = issuer;
        this.audience = audience;
    }

    public String generateToken(Authentication authentication) {
        Instant now = Instant.now();
        long expiry = 86400L; // 24 hours in seconds

        String scope = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.joining(" "));

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .audience(java.util.List.of(audience))
                .issuedAt(now)
                .expiresAt(now.plusSeconds(expiry))
                .subject(authentication.getName())
                .claim("scope", scope)
                .build();

        return this.encoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
    }
}
