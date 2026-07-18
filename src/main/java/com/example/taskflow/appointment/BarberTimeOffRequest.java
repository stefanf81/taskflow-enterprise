package com.example.taskflow.appointment;

import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

/**
 * Input DTO for creating a barber time-off period. Replaces binding directly to
 * the {@link BarberTimeOff} entity so clients cannot set internal fields such as
 * the generated {@code id} or override the owning {@code barber} association
 * (A1 — mass assignment hardening). The barber is resolved from the path variable.
 */
public record BarberTimeOffRequest(
        @NotNull(message = "Start date is required")
        @FutureOrPresent(message = "Start date must be today or in the future")
        LocalDate startDate,

        @NotNull(message = "End date is required")
        LocalDate endDate,

        @Size(max = 255, message = "Reason must be at most 255 characters")
        String reason
) {
    public BarberTimeOff toEntity(Barber barber) {
        BarberTimeOff timeOff = new BarberTimeOff();
        timeOff.setBarber(barber);
        timeOff.setStartDate(startDate);
        timeOff.setEndDate(endDate);
        timeOff.setReason(reason);
        return timeOff;
    }

    /**
     * Cross-field validation: end date must not precede start date.
     */
    public boolean isDateRangeValid() {
        return startDate != null && endDate != null && !endDate.isBefore(startDate);
    }
}
