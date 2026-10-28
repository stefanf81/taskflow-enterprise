package com.example.taskflow.appointment;
import com.example.taskflow.appointment.stream.AppointmentEventStreamService;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** BKG-8: the controller hands the access token's expiry to the SSE service. */
class AppointmentControllerEventStreamTest {

    private final AppointmentService appointmentService = mock(AppointmentService.class);
    private final AppointmentEventStreamService streams = mock(AppointmentEventStreamService.class);
    private final AppointmentController controller = new AppointmentController(appointmentService, streams, java.time.Clock.systemUTC());

    @Test
    void jwtPrincipalPassesItsExpiryAndIdToTheStream() {
        Instant expiresAt = Instant.parse("2031-03-10T11:00:00Z");
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("admin").jti("jti-1")
                .issuedAt(expiresAt.minusSeconds(3600)).expiresAt(expiresAt).build();
        SseEmitter emitter = new SseEmitter();
        when(streams.subscribe("admin", expiresAt, "jti-1")).thenReturn(emitter);
        MockHttpServletResponse response = new MockHttpServletResponse();

        SseEmitter result = controller.streamAppointmentEvents(new JwtAuthenticationToken(jwt, List.of()), response);

        assertEquals(emitter, result);
        // the id lets a logout (token revocation) close this stream immediately
        verify(streams).subscribe("admin", expiresAt, "jti-1");
        assertEquals("no-cache", response.getHeader("Cache-Control"));
        assertEquals("no", response.getHeader("X-Accel-Buffering"));
    }

    @Test
    void nonJwtPrincipalHasNoExpiry() {
        when(streams.subscribe(any(), any(), any())).thenReturn(new SseEmitter());

        assertNotNull(controller.streamAppointmentEvents(
                new UsernamePasswordAuthenticationToken("admin", "n/a"), new MockHttpServletResponse()));

        verify(streams).subscribe("admin", null, null);
    }

    @Test
    void shopInfoReportsTheClockZoneAndIsPubliclyCacheable() {
        AppointmentController inNewYork = new AppointmentController(appointmentService, streams,
                java.time.Clock.system(java.time.ZoneId.of("America/New_York")));

        var response = inNewYork.getShopInfo();

        assertEquals("America/New_York", response.getBody().timeZone());
        assertEquals("max-age=300, public", response.getHeaders().getCacheControl());
    }
}
