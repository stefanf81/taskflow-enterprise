package com.example.taskflow.core.web;

import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** The JSON error body of every handled exception ({@link GlobalExceptionHandler}). */
record ErrorResponse(
    Instant timestamp,
    int status,
    String error,
    String message,
    String path,
    /** Only for a failed request-body validation (400); absent otherwise. */
    @Nullable List<ValidationError> validationErrors,
    String type,
    String title,
    String detail,
    String instance
) {
    /** Keep the original fields during the mobile-client migration to Problem Details. */
    public ErrorResponse(Instant timestamp, int status, String error, String message, String path,
                         @Nullable List<ValidationError> validationErrors) {
        this(timestamp, status, error, message, path, validationErrors, "about:blank", error, message, path);
    }

    public ErrorResponse(Instant timestamp, int status, String error, String message, String path) {
        this(timestamp, status, error, message, path, null);
    }

    public record ValidationError(String field, String message) {}
}
