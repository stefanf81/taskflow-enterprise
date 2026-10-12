package com.example.taskflow.appointment;

import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Strong enum for appointment lifecycle statuses.
 *
 * <p>{@link #PENDING} and {@link #APPROVED} are the <em>active</em> statuses: they
 * occupy the barber's calendar. {@link #DENIED} (declined by the shop) and
 * {@link #CANCELLED} (withdrawn by the customer, the shop, or because the barber
 * became unavailable) free the slot but keep the row for history.
 */
public enum AppointmentStatus {
    PENDING,
    APPROVED,
    DENIED,
    CANCELLED;

    /** Statuses that block a slot; mirrors the predicate of the partial unique index. */
    public static final java.util.List<AppointmentStatus> ACTIVE = java.util.List.of(PENDING, APPROVED);

    public boolean isActive() {
        return this == PENDING || this == APPROVED;
    }

    /**
     * Parses a status name. A null or blank value is treated as {@link #PENDING}
     * (callers that mean "no filter" check for blank themselves); any other
     * unknown value is rejected instead of silently becoming PENDING.
     *
     * @throws IllegalArgumentException (HTTP 400) for an unknown status
     */
    public static AppointmentStatus fromString(String status) {
        if (status == null || status.isBlank()) {
            return PENDING;
        }
        for (AppointmentStatus value : values()) {
            if (value.name().equalsIgnoreCase(status.trim())) {
                return value;
            }
        }
        throw new IllegalArgumentException("Unknown status '" + sanitize(status) + "'. Valid statuses: "
                + Arrays.stream(values()).map(Enum::name).collect(Collectors.joining(", ")) + ".");
    }

    private static String sanitize(String value) {
        String trimmed = value.trim().replaceAll("[\\r\\n]", "");
        return trimmed.length() > 40 ? trimmed.substring(0, 40) + "..." : trimmed;
    }
}
