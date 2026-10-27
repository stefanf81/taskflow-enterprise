package com.example.taskflow.appointment;

/**
 * Published when an appointment is cancelled (soft-cancelled: the row stays with status
 * {@code CANCELLED}). Carries who cancelled so the notification slice can word the
 * customer's e-mail accordingly. Published inside the cancelling transaction, so the
 * notification outbox row commits or rolls back together with the cancellation.
 */
public record AppointmentCancelledEvent(AppointmentDetails appointment, CancelledBy cancelledBy) {

    public enum CancelledBy {
        /** The signed-in customer cancelled their own booking. */
        CUSTOMER,
        /** A guest cancelled with the booking id and e-mail. */
        GUEST,
        /** An administrator cancelled the booking. */
        ADMIN,
        /** The barber was marked unavailable (time off) for the booking's date. */
        BARBER_UNAVAILABLE
    }
}
