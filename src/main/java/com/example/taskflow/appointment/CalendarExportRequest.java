package com.example.taskflow.appointment;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CalendarExportRequest(
        @NotBlank(message = "Email is required") @Email @Size(max = 100) String email) {}
