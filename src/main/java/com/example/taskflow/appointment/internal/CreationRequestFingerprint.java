package com.example.taskflow.appointment.internal;

import com.example.taskflow.appointment.AppointmentCreateRequest;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

/** Immutable binding to the original creation payload, not the appointment's mutable slot. */
public final class CreationRequestFingerprint {
    private CreationRequestFingerprint() {}

    public static String of(Appointment appointment) {
        return hash(appointment.getCustomerEmail(), appointment.getBarberName(),
                String.valueOf(appointment.getBookingDate()), appointment.getBookingTime(),
                appointment.getServiceType());
    }

    /** The input-only No Preference sentinel is matched to the originally assigned concrete barber. */
    public static String of(AppointmentCreateRequest request, String effectiveBarber) {
        return hash(request.customerEmail(), effectiveBarber,
                String.valueOf(request.bookingDate()), request.bookingTime(), request.serviceType());
    }

    private static String hash(String email, String barber, String date, String time, String service) {
        String normalizedTime = normalized(time);
        if (normalizedTime.length() > 5) {
            normalizedTime = normalizedTime.substring(0, 5);
        }
        // Length-prefixing is unambiguous even when a field contains a delimiter or a newline.
        StringBuilder canonical = new StringBuilder("v1|");
        for (String value : new String[]{normalized(email).toLowerCase(Locale.ROOT),
                normalized(barber), date, normalizedTime, normalized(service)}) {
            canonical.append(value.length()).append(':').append(value);
        }
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is required by the Java runtime", ex);
        }
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim();
    }
}
