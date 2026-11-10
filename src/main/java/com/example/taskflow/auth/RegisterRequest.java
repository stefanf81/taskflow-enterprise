package com.example.taskflow.auth;

import com.example.taskflow.auth.internal.Utf8ByteLength;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
record RegisterRequest(
    @NotBlank(message = "Full name is required") 
    @Size(max = 100) 
    String fullName,
    
    @NotBlank(message = "Email is required") 
    @Email(message = "Valid email is required")
    @Size(max = 100, message = "Email must not exceed 100 characters")
    String email,
    
    @NotBlank(message = "Password is required") 
    @Size(min = 8, message = "Password must be at least 8 characters") 
    @Pattern(regexp = "^(?=.*[0-9])(?=.*[a-zA-Z]).{8,}$", message = "Password must be at least 8 characters long and contain both letters and numbers")
    @Utf8ByteLength(max = 72, message = "Password must not exceed 72 UTF-8 bytes")
    String password,
    
    @NotBlank(message = "Phone number is required")
    @Size(max = 50, message = "Phone must not exceed 50 characters")
    String phone
) {}
