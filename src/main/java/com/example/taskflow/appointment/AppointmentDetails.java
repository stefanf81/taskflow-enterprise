package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;

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

    /** A booking without a status is PENDING, as {@code Appointment.getStatus()} reports it. */
    public AppointmentDetails {
        if (status == null) {
            status = AppointmentStatus.PENDING;
        }
    }

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
                appointment.getStatusEnum());
    }
}
