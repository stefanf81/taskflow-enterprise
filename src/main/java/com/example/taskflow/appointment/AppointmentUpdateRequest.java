package com.example.taskflow.appointment;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record AppointmentUpdateRequest(
    @NotBlank(message = "Status is required")
    @Size(max = 50)
    @Pattern(regexp = "^(PENDING|APPROVED|DENIED)$", message = "Status must be PENDING, APPROVED, or DENIED")
    String status
) {}
