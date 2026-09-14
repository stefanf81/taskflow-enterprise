package com.example.taskflow.appointment;

/**
 * Outcome of {@link AppointmentService#createAppointment}.
 *
 * <p>{@code replayed} is {@code true} when the request matched a previously
 * persisted appointment through its {@code Idempotency-Key} and no new row was
 * created. The controller maps a replay to HTTP 200 and a fresh booking to
 * HTTP 201.
 */
public record AppointmentCreationResult(AppointmentResponse appointment, boolean replayed) {

    public static AppointmentCreationResult created(AppointmentResponse appointment) {
        return new AppointmentCreationResult(appointment, false);
    }

    public static AppointmentCreationResult replayed(AppointmentResponse appointment) {
        return new AppointmentCreationResult(appointment, true);
    }
}
