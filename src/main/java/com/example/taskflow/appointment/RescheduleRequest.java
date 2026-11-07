package com.example.taskflow.appointment;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;

public record RescheduleRequest(
        @NotNull(message = "Booking date is required") LocalDate bookingDate,
        @NotBlank(message = "Booking time is required")
        @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "Booking time must be in 24h HH:mm format")
        String bookingTime) {}
