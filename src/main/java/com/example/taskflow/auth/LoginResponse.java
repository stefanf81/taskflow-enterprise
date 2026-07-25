package com.example.taskflow.auth;

public record LoginResponse(String username, String role, String token) {
    public LoginResponse(String username, String role) {
        this(username, role, null);
    }
}
