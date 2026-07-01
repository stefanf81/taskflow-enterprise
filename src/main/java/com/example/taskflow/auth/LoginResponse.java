package com.example.taskflow.auth;

public record LoginResponse(String token, String username, String role) {}
