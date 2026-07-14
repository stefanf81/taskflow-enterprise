package com.example.taskflow.appointment;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record CancelRequest(
    @NotBlank(message = "Email is required")
    @Email(message = "Email must be valid")
    String email
) {}
