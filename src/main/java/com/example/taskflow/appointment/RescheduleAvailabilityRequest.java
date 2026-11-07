package com.example.taskflow.appointment;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** A guest proves the booking with its email (like cancel and reschedule) and names the day to check. */
public record RescheduleAvailabilityRequest(
        @NotBlank(message = "Email is required") @Email @Size(max = 100) String email,
        @NotNull(message = "Booking date is required") LocalDate bookingDate) {}
