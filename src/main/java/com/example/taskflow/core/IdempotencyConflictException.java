package com.example.taskflow.core;

/**
 * Thrown when an {@code Idempotency-Key} is replayed with a different customer
 * or booking payload than the one it originally created. Mapped to HTTP 409 by
 * {@link GlobalExceptionHandler}; the response deliberately carries no
 * appointment data so a key holder cannot read another customer's booking.
 */
public class IdempotencyConflictException extends RuntimeException {

    public IdempotencyConflictException(String message) {
        super(message);
    }
}
