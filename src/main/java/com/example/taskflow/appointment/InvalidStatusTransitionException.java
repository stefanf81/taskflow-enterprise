package com.example.taskflow.appointment;

import com.example.taskflow.core.ConflictException;

/**
 * Thrown when an appointment is asked to move to a status its current status
 * does not allow (for example, anything on a cancelled booking). HTTP 409.
 */
public class InvalidStatusTransitionException extends ConflictException {

    public InvalidStatusTransitionException(String from, String to) {
        super("Cannot change an appointment from " + from + " to " + to + ".");
    }
}
