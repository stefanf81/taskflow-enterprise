package com.example.taskflow.appointment;

import java.time.LocalDate;

/**
 * Immutable snapshot of an appointment for other modules. The {@link Appointment} entity stays
 * inside this module: events and {@link AppointmentService} hand out this view instead, so
 * {@code notification} and {@code review} never hold a managed entity of ours.
 */
public record AppointmentDetails(
        Long id,
        String publicId,
        String customerName,
        String customerEmail,
        String barberName,
        String serviceType,
        LocalDate bookingDate,
        String bookingTime,
        AppointmentStatus status) {

    static AppointmentDetails of(Appointment appointment) {
        return new AppointmentDetails(
                appointment.getId(),
                appointment.getPublicId(),
                appointment.getCustomerName(),
                appointment.getCustomerEmail(),
                appointment.getBarberName(),
                appointment.getServiceType(),
                appointment.getBookingDate(),
                appointment.getBookingTime(),
                appointment.getStatusEnum() != null ? appointment.getStatusEnum() : AppointmentStatus.PENDING);
    }
}
