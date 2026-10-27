package com.example.taskflow.testsupport;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentStatus;

/** Builds the read-only {@link AppointmentDetails} view other modules receive from a test entity. */
public final class AppointmentDetailsFixtures {

    private AppointmentDetailsFixtures() {
    }

    public static AppointmentDetails of(Appointment appointment) {
        AppointmentStatus status = appointment.getStatusEnum() != null
                ? appointment.getStatusEnum() : AppointmentStatus.PENDING;
        return new AppointmentDetails(
                appointment.getId(),
                appointment.getPublicId(),
                appointment.getCustomerName(),
                appointment.getCustomerEmail(),
                appointment.getBarberName(),
                appointment.getServiceType(),
                appointment.getBookingDate(),
                appointment.getBookingTime(),
                status);
    }
}
