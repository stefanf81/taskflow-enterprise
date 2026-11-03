package com.example.taskflow.core;

import org.springframework.http.HttpStatus;

/**
 * A business-rule failure that carries its own HTTP status. The shared exception handler maps
 * every subclass the same way (status, reason phrase, the exception's message, the request path),
 * so a module can define its own exceptions without the shared kernel knowing their types.
 */
public abstract class DomainException extends RuntimeException {

    private final HttpStatus status;

    protected DomainException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
