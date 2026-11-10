package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.stereotype.Component;

/** Identical refusal for missing and wrong-owner IDs; no UUID-only public booking lookup. */
@Component
class AppointmentOwnership {
    private final AppointmentRepository repository;

    AppointmentOwnership(AppointmentRepository repository) {
        this.repository = repository;
    }

    Appointment requireOwned(String publicId, String email) {
        Appointment appointment = repository.findByPublicId(publicId);
        if (appointment == null || email == null || appointment.getCustomerEmail() == null
                || !appointment.getCustomerEmail().trim().equalsIgnoreCase(email.trim())) {
            throw new ResourceNotFoundException("Appointment not found or unauthorized.");
        }
        return appointment;
    }
}
