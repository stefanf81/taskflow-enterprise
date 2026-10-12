package com.example.taskflow.core;

/**
 * A request that is well-formed but conflicts with the current state of a
 * resource (an illegal status transition, a slot that is no longer free).
 * Mapped to HTTP 409 by {@link GlobalExceptionHandler}.
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
