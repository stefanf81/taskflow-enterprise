package com.example.taskflow.core;

import java.time.Instant;
import java.util.List;

public record ErrorResponse(
    Instant timestamp,
    int status,
    String error,
    String message,
    String path,
    List<ValidationError> validationErrors
) {
    public ErrorResponse(int status, String error, String message, String path) {
        this(Instant.now(), status, error, message, path, null);
    }

    public ErrorResponse(int status, String error, String message, String path, List<ValidationError> validationErrors) {
        this(Instant.now(), status, error, message, path, validationErrors);
    }

    public record ValidationError(String field, String message) {}
}
