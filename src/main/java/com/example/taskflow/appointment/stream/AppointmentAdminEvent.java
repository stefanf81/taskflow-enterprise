package com.example.taskflow.appointment.stream;

import java.time.Instant;

/**
 * Immutable, PII-free signal for refreshing an administrator's appointment view.
 * The REST dashboard remains the authoritative source of appointment data.
 */
public record AppointmentAdminEvent(Type type, Long appointmentId, Instant occurredAt) {

    public enum Type {
        CREATED,
        UPDATED,
        DELETED
    }
}
