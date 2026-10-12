package com.example.taskflow.auth;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RequestScopedJwtDecoderTest {

    private final JwtDecoder delegate = mock(JwtDecoder.class);
    private final RequestScopedJwtDecoder decoder = new RequestScopedJwtDecoder(delegate);

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static Jwt jwt(String token) {
        Instant now = Instant.now();
        return Jwt.withTokenValue(token).header("alg", "RS256").subject("u")
                .issuedAt(now).expiresAt(now.plusSeconds(60)).build();
    }

    private static void inRequest() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
    }

    @Test
    void theSameTokenIsVerifiedOnlyOncePerRequest() {
        inRequest();
        Jwt decoded = jwt("tok");
        when(delegate.decode("tok")).thenReturn(decoded);

        assertSame(decoded, decoder.decode("tok")); // stale-cookie filter
        assertSame(decoded, decoder.decode("tok")); // bearer-token filter

        verify(delegate, times(1)).decode("tok");
    }

    @Test
    void aDifferentTokenOrANewRequestIsVerifiedAgain() {
        inRequest();
        when(delegate.decode("a")).thenReturn(jwt("a"));
        when(delegate.decode("b")).thenReturn(jwt("b"));

        decoder.decode("a");
        decoder.decode("b");
        inRequest(); // next request
        decoder.decode("a");

        verify(delegate, times(2)).decode("a");
        verify(delegate, times(1)).decode("b");
    }

    @Test
    void failuresAreNeverCachedAndNoRequestMeansNoCaching() {
        inRequest();
        when(delegate.decode("bad")).thenThrow(new BadJwtException("expired"));
        assertThrows(BadJwtException.class, () -> decoder.decode("bad"));
        assertThrows(BadJwtException.class, () -> decoder.decode("bad"));
        verify(delegate, times(2)).decode("bad");

        RequestContextHolder.resetRequestAttributes();
        when(delegate.decode("tok")).thenReturn(jwt("tok"));
        decoder.decode("tok");
        decoder.decode("tok");
        verify(delegate, times(2)).decode("tok");
    }
}
