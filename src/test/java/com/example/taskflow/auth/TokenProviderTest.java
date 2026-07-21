package com.example.taskflow.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TokenProviderTest {

    @Mock
    private JwtEncoder encoder;

    @Mock
    private Authentication authentication;

    private TokenProvider tokenProvider;

    @BeforeEach
    void setUp() {
        tokenProvider = new TokenProvider(encoder, "test-issuer", "test-audience");
    }

    @Test
    void generateToken_shouldEncodeJwt() {
        GrantedAuthority authority = () -> "ROLE_ADMIN";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority));
        when(authentication.getName()).thenReturn("admin@test.com");

        Jwt mockJwt = Jwt.withTokenValue("encoded-jwt-value")
                .header("alg", "RS256")
                .subject("admin@test.com")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .issuer("test-issuer")
                .claim("scope", "ROLE_ADMIN")
                .build();
        when(encoder.encode(any(JwtEncoderParameters.class))).thenReturn(mockJwt);

        String token = tokenProvider.generateToken(authentication);

        assertEquals("encoded-jwt-value", token);
        verify(encoder).encode(any(JwtEncoderParameters.class));
    }

    @Test
    void generateToken_shouldUseCustomIssuerAndAudience() {
        TokenProvider customProvider = new TokenProvider(encoder, "custom-issuer", "custom-audience");

        GrantedAuthority authority = () -> "ROLE_CUSTOMER";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority));
        when(authentication.getName()).thenReturn("user@test.com");

        Jwt mockJwt = Jwt.withTokenValue("custom-token")
                .header("alg", "RS256")
                .subject("user@test.com")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .claim("scope", "ROLE_CUSTOMER")
                .build();
        when(encoder.encode(any(JwtEncoderParameters.class))).thenReturn(mockJwt);

        String token = customProvider.generateToken(authentication);
        assertEquals("custom-token", token);
    }

    @Test
    void generateToken_shouldIncludeScopeClaim() {
        GrantedAuthority authority1 = () -> "ROLE_ADMIN";
        GrantedAuthority authority2 = () -> "FACTOR_PASSWORD";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority1, authority2));
        when(authentication.getName()).thenReturn("admin@test.com");

        Jwt mockJwt = Jwt.withTokenValue("scope-token")
                .header("alg", "RS256")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .claim("scope", "ROLE_ADMIN FACTOR_PASSWORD")
                .build();
        when(encoder.encode(any(JwtEncoderParameters.class))).thenReturn(mockJwt);

        tokenProvider.generateToken(authentication);

        ArgumentCaptor<JwtEncoderParameters> captor = ArgumentCaptor.forClass(JwtEncoderParameters.class);
        verify(encoder).encode(captor.capture());
        String scope = captor.getValue().getClaims().getClaimAsString("scope");
        assertTrue(scope.contains("ROLE_ADMIN"));
        assertTrue(scope.contains("FACTOR_PASSWORD"));
    }

    @Test
    void generateToken_shouldSetOneHourExpiry() {
        GrantedAuthority authority = () -> "ROLE_CUSTOMER";
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of(authority));
        when(authentication.getName()).thenReturn("user@test.com");

        Jwt mockJwt = Jwt.withTokenValue("exp-token")
                .header("alg", "RS256")
                .subject("user@test.com")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .claim("scope", "ROLE_CUSTOMER")
                .build();
        when(encoder.encode(any(JwtEncoderParameters.class))).thenReturn(mockJwt);

        tokenProvider.generateToken(authentication);
        ArgumentCaptor<JwtEncoderParameters> captor = ArgumentCaptor.forClass(JwtEncoderParameters.class);
        verify(encoder).encode(captor.capture());
        var claims = captor.getValue().getClaims();
        Instant expiresAt = claims.getExpiresAt();
        Instant issuedAt = claims.getIssuedAt();
        assertNotNull(expiresAt);
        assertNotNull(issuedAt);
        assertEquals(3600L, expiresAt.getEpochSecond() - issuedAt.getEpochSecond());
    }
}
