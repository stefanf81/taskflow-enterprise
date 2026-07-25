package com.example.taskflow.appointment;

/**
 * Strong enum for appointment lifecycle statuses.
 */
public enum AppointmentStatus {
    PENDING,
    APPROVED,
    DENIED;

    public static AppointmentStatus fromString(String status) {
        if (status == null || status.isBlank()) {
            return PENDING;
        }
        for (AppointmentStatus value : values()) {
            if (value.name().equalsIgnoreCase(status.trim())) {
                return value;
            }
        }
        return PENDING;
    }
}
