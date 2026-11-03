package com.example.taskflow.core.web;

import java.time.Instant;
import java.util.List;

/** The JSON error body of every handled exception ({@link GlobalExceptionHandler}). */
record ErrorResponse(
    Instant timestamp,
    int status,
    String error,
    String message,
    String path,
    List<ValidationError> validationErrors
) {
    public ErrorResponse(Instant timestamp, int status, String error, String message, String path) {
        this(timestamp, status, error, message, path, null);
    }

    public record ValidationError(String field, String message) {}
}
