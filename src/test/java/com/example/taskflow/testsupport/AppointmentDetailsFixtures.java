package com.example.taskflow.testsupport;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.AppointmentDetails;

/** Builds the read-only {@link AppointmentDetails} view other modules receive from a test entity. */
public final class AppointmentDetailsFixtures {

    private AppointmentDetailsFixtures() {
    }

    public static AppointmentDetails of(Appointment appointment) {
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
