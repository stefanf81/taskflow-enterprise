package com.example.taskflow.auth;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.stream.Collectors;

@Component
class TokenProvider {

    /**
     * The clock tokens are issued and judged by: the system clock in UTC, the same one the Nimbus
     * decoder's timestamp validator checks {@code exp} against. Deliberately not the shop
     * {@code Clock} bean: tests replace that with a fixed or movable clock, and tokens issued from it
     * would be expired (or far in the future) for the decoder. {@link TokenRevocationList} uses it
     * for the same reason.
     */
    static final Clock TOKEN_CLOCK = Clock.systemUTC();

    private final long tokenLifetimeSeconds;

    private final JwtEncoder encoder;
    private final String issuer;
    private final String audience;
    private final Clock clock;

    @Autowired
    public TokenProvider(JwtEncoder encoder, JwtProperties jwt) {
        this(encoder, jwt, TOKEN_CLOCK);
    }

    TokenProvider(JwtEncoder encoder, JwtProperties jwt, Clock clock) {
        this.encoder = encoder;
        this.issuer = jwt.issuer();
        this.audience = jwt.audience();
        this.tokenLifetimeSeconds = jwt.lifetimeSeconds();
        this.clock = clock;
    }

    public String generateToken(Authentication authentication) {
        Instant now = Instant.now(clock);

        String scope = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.joining(" "));

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .audience(java.util.List.of(audience))
                .issuedAt(now)
                .expiresAt(now.plusSeconds(tokenLifetimeSeconds))
                .subject(authentication.getName())
                // Unique id so a single token can be denied at logout (TokenRevocationList).
                .id(java.util.UUID.randomUUID().toString())
                .claim("scope", scope)
                .build();

        return this.encoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
    }

    public long getTokenLifetimeSeconds() {
        return tokenLifetimeSeconds;
    }
}
