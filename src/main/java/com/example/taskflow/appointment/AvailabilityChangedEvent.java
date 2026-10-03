package com.example.taskflow.appointment;

import java.time.LocalDate;

/**
 * Signals that barber availability changed and the {@code busySlots} cache must
 * be invalidated for the affected barber(s) and date range.
 *
 * <p>Published from every availability-mutating path (booking create/status
 * change/delete/public cancel, time-off, barber creation) and consumed by
 * {@link AvailabilityCacheEvictionListener} after the transaction commits, so a
 * rolled-back mutation never clears committed cache state.
 *
 * <p>A {@code null} {@code barberName} with {@code null} dates means "all
 * barbers, all dates" (used when the roster itself changes, because the
 * "First Available" aggregate spans every barber and every date).
 */
public record AvailabilityChangedEvent(String barberName, LocalDate startDate, LocalDate endDate) {

    /** A single barber on a single date. */
    public static AvailabilityChangedEvent single(String barberName, LocalDate bookingDate) {
        return new AvailabilityChangedEvent(barberName, bookingDate, bookingDate);
    }

    /** A single barber across an inclusive date range (time off). */
    public static AvailabilityChangedEvent range(String barberName, LocalDate startDate, LocalDate endDate) {
        return new AvailabilityChangedEvent(barberName, startDate, endDate);
    }

    /** The barber roster changed: the aggregate availability of every date is affected. */
    public static AvailabilityChangedEvent allBarbers() {
        return new AvailabilityChangedEvent(null, null, null);
    }

    public boolean affectsAllBarbers() {
        return barberName == null;
    }
}
