package com.example.taskflow.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
    @NotBlank(message = "Full name is required") 
    @Size(max = 100) 
    String fullName,
    
    @NotBlank(message = "Email is required") 
    @Email(message = "Valid email is required") 
    String email,
    
    @NotBlank(message = "Password is required") 
    @Size(min = 8, message = "Password must be at least 8 characters") 
    String password,
    
    String phone
) {}
