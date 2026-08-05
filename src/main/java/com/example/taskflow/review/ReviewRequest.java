package com.example.taskflow.review;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record ReviewRequest(
    @NotNull(message = "Rating is required") 
    @Min(value = 1, message = "Rating must be at least 1") 
    @Max(value = 5, message = "Rating must be at most 5") 
    Integer rating,

    @Size(max = 1000, message = "Comment must not exceed 1000 characters")
    String comment,

    @NotBlank(message = "Verification email is required")
    @Email(message = "Verification email must be a valid email address")
    @Size(max = 100, message = "Email must not exceed 100 characters")
    String customerEmail
) {}