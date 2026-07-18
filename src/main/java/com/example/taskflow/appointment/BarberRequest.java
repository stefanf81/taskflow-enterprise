package com.example.taskflow.appointment;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Input DTO for creating a barber. Replaces binding directly to the {@link Barber}
 * entity so clients cannot set internal fields such as the generated {@code id}
 * (A1 — mass assignment hardening).
 */
public record BarberRequest(
        @NotBlank(message = "Barber name is required")
        @Size(max = 100, message = "Barber name must be at most 100 characters")
        String name,

        @Email(message = "Email must be valid")
        @Size(max = 100, message = "Email must be at most 100 characters")
        String email,

        @Size(max = 50, message = "Phone must be at most 50 characters")
        String phone
) {
    public Barber toEntity() {
        return new Barber(name, email, phone);
    }
}
