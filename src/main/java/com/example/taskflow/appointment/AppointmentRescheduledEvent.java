package com.example.taskflow.appointment;

/** Immutable before/after snapshots, published inside the move transaction (no delivery claim). */
public record AppointmentRescheduledEvent(
        AppointmentDetails previous,
        AppointmentDetails appointment,
        RescheduledBy rescheduledBy) {
    public enum RescheduledBy { GUEST, CUSTOMER }
}
