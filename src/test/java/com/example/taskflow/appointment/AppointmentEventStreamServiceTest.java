package com.example.taskflow.appointment;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AppointmentEventStreamServiceTest {

    @Test
    void limitsConnectionsPerAdministrator() {
        AppointmentEventStreamService service = new AppointmentEventStreamService(1);

        SseEmitter emitter = service.subscribe("admin");

        assertNotNull(emitter);
        assertEquals(1, service.connectionCount("admin"));
        ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                () -> service.subscribe("admin"));
        assertEquals(429, exception.getStatusCode().value());
    }

    @Test
    void publishesAndSendsHeartbeatsWithoutLeakingConnectionState() {
        AppointmentEventStreamService service = new AppointmentEventStreamService(2);
        service.subscribe("admin");

        service.publish(new AppointmentAdminEvent(AppointmentAdminEvent.Type.CREATED, 42L,
                java.time.Instant.parse("2026-08-06T12:00:00Z")));
        service.sendHeartbeats();

        assertEquals(1, service.connectionCount("admin"));
    }
}
