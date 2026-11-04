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

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
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
        tokenProvider = new TokenProvider(encoder, new JwtProperties("test-issuer", "test-audience", 3600L));
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
        TokenProvider customProvider = new TokenProvider(encoder, new JwtProperties("custom-issuer", "custom-audience", 7200L));

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

    @Test
    void getTokenLifetimeSeconds_shouldMatchJwtLifetime() {
        assertEquals(3600L, tokenProvider.getTokenLifetimeSeconds());
    }

    @Test
    void issuedAtAndExpiryComeFromTheTokenClock() {
        Instant now = Instant.parse("2026-10-12T08:00:00Z");
        TokenProvider fixed = new TokenProvider(encoder, new JwtProperties("test-issuer", "test-audience", 3600L),
                Clock.fixed(now, ZoneOffset.UTC));
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of());
        when(authentication.getName()).thenReturn("user@test.com");
        when(encoder.encode(any(JwtEncoderParameters.class))).thenReturn(Jwt.withTokenValue("t")
                .header("alg", "RS256").claim("scope", "").build());

        fixed.generateToken(authentication);

        ArgumentCaptor<JwtEncoderParameters> captor = ArgumentCaptor.forClass(JwtEncoderParameters.class);
        verify(encoder).encode(captor.capture());
        assertEquals(now, captor.getValue().getClaims().getIssuedAt());
        assertEquals(now.plusSeconds(3600), captor.getValue().getClaims().getExpiresAt());
    }

    /** The account's token version goes into the token, so raising it revokes this token too (#218). */
    @Test
    void theAccountsTokenVersionIsCopiedIntoTheToken() {
        TokenProvider versioned = new TokenProvider(encoder, new JwtProperties("test-issuer", "test-audience", 3600L),
                TokenProvider.TOKEN_CLOCK, username -> "user@test.com".equals(username) ? 7 : 0);
        when(authentication.getAuthorities()).thenAnswer(invocation -> List.of());
        when(authentication.getName()).thenReturn("user@test.com");
        when(encoder.encode(any(JwtEncoderParameters.class))).thenReturn(Jwt.withTokenValue("t")
                .header("alg", "RS256").claim("scope", "").build());

        versioned.generateToken(authentication);

        ArgumentCaptor<JwtEncoderParameters> captor = ArgumentCaptor.forClass(JwtEncoderParameters.class);
        verify(encoder).encode(captor.capture());
        assertEquals(7, ((Number) captor.getValue().getClaims().getClaim(AccountTokenCheck.VERSION_CLAIM)).intValue());
    }

    /** The decoder checks exp against the system clock, so tokens must not follow a test's shop Clock. */
    @Test
    void tokensAreIssuedByTheSystemClockTheDecoderUses() {
        assertEquals(Clock.systemUTC(), TokenProvider.TOKEN_CLOCK);
    }
}
