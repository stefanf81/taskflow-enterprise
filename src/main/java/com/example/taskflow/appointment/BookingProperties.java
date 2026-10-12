package com.example.taskflow.appointment;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.List;

/**
 * Booking policy, bound from {@code app.booking.*}.
 *
 * <ul>
 *   <li>{@code max-advance-days} (default 90): how far ahead a booking may be made.</li>
 *   <li>{@code max-active-per-email} (default 5): PENDING/APPROVED bookings dated today or
 *       later one e-mail address may hold at the same time.</li>
 *   <li>{@code default-shift-start} / {@code default-shift-end} (default 09:00 / 17:00) and
 *       {@code default-working-days} (ISO weekday numbers, default 1-6 = Mon-Sat): the
 *       schedule given to a newly created barber, matching the seeded barbers.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.booking")
public record BookingProperties(
        @DefaultValue("90") int maxAdvanceDays,
        @DefaultValue("5") int maxActivePerEmail,
        @DefaultValue("09:00") String defaultShiftStart,
        @DefaultValue("17:00") String defaultShiftEnd,
        @DefaultValue({"1", "2", "3", "4", "5", "6"}) List<Integer> defaultWorkingDays) {

    public BookingProperties {
        if (maxAdvanceDays < 1) {
            throw new IllegalArgumentException("app.booking.max-advance-days must be at least 1");
        }
        if (maxActivePerEmail < 1) {
            throw new IllegalArgumentException("app.booking.max-active-per-email must be at least 1");
        }
        LocalTime start = LocalTime.parse(defaultShiftStart.trim());
        LocalTime end = LocalTime.parse(defaultShiftEnd.trim());
        if (!end.isAfter(start)) {
            throw new IllegalArgumentException("app.booking.default-shift-end must be after default-shift-start");
        }
        defaultWorkingDays = List.copyOf(defaultWorkingDays);
        for (Integer day : defaultWorkingDays) {
            DayOfWeek.of(day); // rejects anything outside 1..7
        }
    }

    /** The built-in defaults (also what the tests use). */
    public static BookingProperties defaults() {
        return new BookingProperties(90, 5, "09:00", "17:00", List.of(1, 2, 3, 4, 5, 6));
    }

    public LocalTime shiftStart() {
        return LocalTime.parse(defaultShiftStart.trim());
    }

    public LocalTime shiftEnd() {
        return LocalTime.parse(defaultShiftEnd.trim());
    }
}
