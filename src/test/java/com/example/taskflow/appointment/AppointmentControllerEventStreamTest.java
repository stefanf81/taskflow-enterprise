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

    private final AppointmentQueryService queryService = mock(AppointmentQueryService.class);
    private final AppointmentBookingService bookingService = mock(AppointmentBookingService.class);
    private final AppointmentLifecycleService lifecycleService = mock(AppointmentLifecycleService.class);
    private final AppointmentEventStreamService streams = mock(AppointmentEventStreamService.class);
    private final BarberService barberService = mock(BarberService.class);
    private final AppointmentController controller = new AppointmentController(queryService, bookingService,
            lifecycleService, streams, barberService, BookingProperties.defaults(), java.time.Clock.systemUTC());

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
    void shopInfoReportsTheClockZoneWindowAndHoursAndIsPubliclyCacheable() {
        List<OpeningHoursResponse> hours = List.of(new OpeningHoursResponse(1, "09:00", "17:00"));
        when(barberService.getOpeningHours()).thenReturn(hours);
        BookingProperties window = new BookingProperties(30, 5, "09:00", "17:00", List.of(1));
        AppointmentController inNewYork = new AppointmentController(queryService, bookingService, lifecycleService,
                streams, barberService, window, java.time.Clock.system(java.time.ZoneId.of("America/New_York")));

        var response = inNewYork.getShopInfo();

        assertEquals("America/New_York", response.getBody().timeZone());
        assertEquals(30, response.getBody().maxAdvanceDays());
        assertEquals(hours, response.getBody().openingHours());
        // Public, but revalidated: an admin's schedule change must not hide behind a max-age.
        assertEquals("no-cache, public", response.getHeaders().getCacheControl());
    }
}
