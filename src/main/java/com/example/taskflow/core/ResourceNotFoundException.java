package com.example.taskflow.core;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** A resource (appointment, barber, service, ...) that does not exist. HTTP 404. */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class ResourceNotFoundException extends DomainException {
    public ResourceNotFoundException(String message) {
        super(HttpStatus.NOT_FOUND, message);
    }
}
