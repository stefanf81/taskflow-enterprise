package com.example.taskflow.core;

import org.springframework.http.HttpStatus;

/**
 * A request that is well-formed but conflicts with the current state of a
 * resource (an illegal status transition, a slot that is no longer free). HTTP 409.
 */
public class ConflictException extends DomainException {

    public ConflictException(String message) {
        super(HttpStatus.CONFLICT, message);
    }
}
