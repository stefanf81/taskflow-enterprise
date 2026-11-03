package com.example.taskflow.appointment;

import com.example.taskflow.core.DomainException;
import org.springframework.http.HttpStatus;

/**
 * Thrown when an {@code Idempotency-Key} is replayed with a different customer
 * or booking payload than the one it originally created. HTTP 409 (mapped by the
 * shared handler for {@link DomainException}); the response deliberately carries no
 * appointment data so a key holder cannot read another customer's booking.
 */
public class IdempotencyConflictException extends DomainException {

    public IdempotencyConflictException(String message) {
        super(HttpStatus.CONFLICT, message);
    }
}
