package com.example.taskflow.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

record RefreshRequest(@NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String refreshToken) {}
