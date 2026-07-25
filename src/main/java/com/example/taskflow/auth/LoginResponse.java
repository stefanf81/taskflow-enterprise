package com.example.taskflow.auth;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record LoginResponse(String username, String role, String token) {
    public LoginResponse(String username, String role) {
        this(username, role, null);
    }
}
