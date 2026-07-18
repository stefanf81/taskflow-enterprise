package com.example.taskflow.appointment;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public record AppointmentCreateRequest(
    @NotBlank(message = "Customer name is required")
    @Size(max = 100)
    String customerName,

    @NotBlank(message = "Customer email is required")
    @Email(message = "Invalid email format")
    @Size(max = 100)
    String customerEmail,

    @NotBlank(message = "Customer phone is required")
    @Size(max = 50)
    String customerPhone,

    @NotBlank(message = "Barber name is required")
    @Size(max = 100)
    String barberName,

    @NotNull(message = "Booking date is required")
    LocalDate bookingDate,

    @NotBlank(message = "Booking time is required")
    @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "Booking time must be in 24h HH:mm format")
    String bookingTime,

    @NotBlank(message = "Service type is required")
    @Size(max = 100)
    String serviceType
) {}
