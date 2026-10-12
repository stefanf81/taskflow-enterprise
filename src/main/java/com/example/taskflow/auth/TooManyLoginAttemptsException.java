package com.example.taskflow.auth;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Raised when an account has exceeded the allowed number of failed logins; maps to HTTP 429. */
public class TooManyLoginAttemptsException extends ResponseStatusException {

    private final long retryAfterSeconds;

    public TooManyLoginAttemptsException(long retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, "Too many failed login attempts. Please try again later.");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    @Override
    public HttpHeaders getHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfterSeconds));
        return headers;
    }
}
