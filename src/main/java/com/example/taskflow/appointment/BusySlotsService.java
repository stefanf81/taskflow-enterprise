package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.LogSanitizer;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Barber availability rules and busy-slot calculation.
 * Extracted from AppointmentServiceImpl to prevent self-invocation cache bypass
 * and comply with ArchUnit rules against field injection.
 *
 * <p>An appointment occupies the half-open interval {@code [start, end)}, where {@code end} is the
 * stored {@code booking_end_time} (start + service duration at booking time). A new booking is
 * acceptable when its start is a grid slot, lies in the barber's working window, its end does not
 * pass closing time, the barber is not on time off, and its interval overlaps no PENDING/APPROVED
 * appointment of that barber. {@link #evaluate} is the single implementation of those rules: a pure
 * function over a {@link BarberDay}, which is loaded with a constant number of set-based queries
 * whatever the number of barbers. Booking creation, admin approval, "No Preference" resolution and
 * the busy-slot lists all go through it. On PostgreSQL the {@code appointments_no_overlap}
 * exclusion constraint (V35) also enforces the overlap rule against concurrent inserts.
 */
@Service
@Transactional(readOnly = true)
public class BusySlotsService {

    /**
     * All possible operating time slots (09:00 - 17:00, with a 1-hour lunch break at 12:00).
     * Synchronized with shared frontend/mobile tokens (DEFAULT_TIME_SLOTS). A booking must
     * start on one of these.
     */
    public static final List<String> ALL_SLOTS =
            List.of("09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00");

    /**
     * Length assumed for a service without a positive duration, and for legacy appointments that
     * had no service reference when V35 backfilled their end time (one grid step).
     */
    public static final int DEFAULT_DURATION_MINUTES = Appointment.DEFAULT_DURATION_MINUTES;

    /**
     * Everything the booking rules need to know about one barber on one date.
     *
     * @param schedule the barber's working window on that weekday, or {@code null} when not scheduled
     * @param active   the barber's PENDING/APPROVED appointments on that date
     */
    record BarberDay(Barber barber, boolean onTimeOff, BarberSchedule schedule, List<Appointment> active) {
    }

    private final BarberRepository barberRepository;
    private final BarberScheduleRepository barberScheduleRepository;
    private final BarberTimeOffRepository barberTimeOffRepository;
    private final AppointmentRepository appointmentRepository;

    public BusySlotsService(BarberRepository barberRepository,
                            BarberScheduleRepository barberScheduleRepository,
                            BarberTimeOffRepository barberTimeOffRepository,
                            AppointmentRepository appointmentRepository) {
        this.barberRepository = barberRepository;
        this.barberScheduleRepository = barberScheduleRepository;
        this.barberTimeOffRepository = barberTimeOffRepository;
        this.appointmentRepository = appointmentRepository;
    }

    /**
     * Busy grid slots for a barber on a date.
     *
     * <p>Failures are deliberately NOT swallowed: an exception (unknown barber, malformed
     * date, database error) is never cached, whereas a returned "everything is busy" list
     * would be stored for the cache TTL. Database outages therefore surface as 503 (see
     * {@code GlobalExceptionHandler}) instead of being cached as "fully booked".
     *
     * @throws IllegalArgumentException (HTTP 400) for a malformed date or an unknown barber
     */
    @Cacheable(value = "busySlots", key = "#barberName + '-' + #bookingDate", sync = true)
    public List<String> getBusySlots(String barberName, String bookingDate) {
        LocalDate date = parseDate(bookingDate);

        // H3: "No Preference" sentinel must aggregate across ALL barbers.
        // A slot is busy (unavailable) only when NO working barber can accept it.
        if (AppointmentServiceImpl.NO_PREFERENCE_BARBER.equals(barberName)) {
            return computeNoPreferenceBusySlots(date);
        }

        Barber barber = barberRepository.findByName(barberName)
                .orElseThrow(() -> unknownBarber(barberName));
        BarberDay day = loadBarberDay(barber, date);

        // Time off or not scheduled that weekday: every slot is busy (a legitimate, cacheable
        // answer). Otherwise busy = outside the working window or covered by an active appointment.
        return ALL_SLOTS.stream()
                .filter(slot -> isBusy(LocalTime.parse(slot), day))
                .toList();
    }

    /**
     * The single availability rule set for placing (or re-validating) a booking with a named barber.
     *
     * @param excludeAppointmentId a row to ignore when checking overlap (the appointment being
     *                             re-approved), or {@code null}
     * @return the reason the booking cannot be placed, or empty when it can
     */
    public Optional<String> findConflict(Barber barber, LocalDate date, LocalTime start,
                                         int durationMinutes, Long excludeAppointmentId) {
        return evaluate(loadBarberDay(barber, date), start, durationMinutes,
                excludeAppointmentId);
    }

    /**
     * The booking rules as a pure function of preloaded data: time off, schedule, working window,
     * service length vs. closing time, then overlap with the barber's active appointments (each with
     * its own stored end time). Checked in that order, so the reason reported is the first that applies.
     */
    static Optional<String> evaluate(BarberDay day, LocalTime start, int durationMinutes,
                                     Long excludeAppointmentId) {
        if (day.onTimeOff()) {
            return Optional.of("The selected barber is unavailable on this date (time off). "
                    + "Please choose another date or barber.");
        }

        BarberSchedule schedule = day.schedule();
        if (schedule == null) {
            return Optional.of("The selected barber is not scheduled to work on the requested date.");
        }
        if (start.isBefore(schedule.getStartTime()) || !start.isBefore(schedule.getEndTime())) {
            return Optional.of("Booking time must be within the barber's working hours ("
                    + schedule.getStartTime() + "–" + schedule.getEndTime() + ").");
        }
        // Compare in minutes of the day: LocalTime.plusMinutes wraps past midnight.
        int startMinute = minuteOf(start);
        if (startMinute + durationMinutes > minuteOf(schedule.getEndTime())) {
            return Optional.of("The selected service takes " + durationMinutes
                    + " minutes and would end after the barber's closing time ("
                    + schedule.getEndTime() + "). Please choose an earlier time.");
        }

        int endMinute = startMinute + durationMinutes;
        for (Appointment other : day.active()) {
            if (excludeAppointmentId != null && excludeAppointmentId.equals(other.getId())) {
                continue;
            }
            if (startMinuteOf(other) < endMinute && startMinute < endMinuteOf(other)) {
                return Optional.of("The selected slot is already booked or unavailable.");
            }
        }
        return Optional.empty();
    }

    /**
     * H2: Resolve the "No Preference (First Available)" booking intent to a
     * concrete barber who can take the booking under exactly the same rules as a named
     * barber (time off, schedule, service length, overlap). Returns empty when no barber can.
     *
     * <p>Deliberately uncached: the caller persists the resolved barber inside
     * the booking transaction, so a cached choice could assign a barber who has
     * been booked since the cache entry was written. Database errors propagate.
     *
     * <p>Issues at most four queries whatever the number of barbers (barbers, time off, schedules,
     * bookings of the date) and evaluates every candidate in memory.
     */
    public Optional<Barber> findFirstAvailableBarber(LocalDate date, String bookingTime, int durationMinutes) {
        if (date == null || bookingTime == null || bookingTime.isBlank()) {
            return Optional.empty();
        }
        LocalTime requested;
        try {
            requested = LocalTime.parse(bookingTime.trim());
        } catch (DateTimeParseException e) {
            return Optional.empty();
        }

        // Deterministic order (lowest id first) so the same slot consistently
        // resolves to the same barber until that barber is booked.
        return loadBarberDays(barberRepository.findAllByOrderByIdAsc(), date).stream()
                .filter(day -> evaluate(day, requested, durationMinutes, null).isEmpty())
                .map(BarberDay::barber)
                .findFirst();
    }

    /** True when {@code bookingTime} (HH:mm) is one of the bookable grid slots. */
    public static boolean isGridSlot(String bookingTime) {
        return bookingTime != null && ALL_SLOTS.contains(bookingTime.trim());
    }

    /** Booked length of an appointment in minutes: its stored interval {@code [start, end)}. */
    public static int durationOf(Appointment appointment) {
        return endMinuteOf(appointment) - startMinuteOf(appointment);
    }

    /**
     * H3: Compute busy slots for the "No Preference (First Available)" sentinel.
     *
     * <p>A slot is considered busy (unavailable) only when NO working barber can
     * accept it — meaning every barber is either on time off, not scheduled that
     * day, outside their window at that slot, or already booked at that time. If at
     * least one working barber is free at a given slot, that slot remains available
     * for the "No Preference" booking.
     *
     * <p>If no barbers exist or none are working that day, ALL_SLOTS is returned
     * as a conservative default (no availability → prevent bookings).
     */
    private List<String> computeNoPreferenceBusySlots(LocalDate date) {
        Set<String> availableSlots = new HashSet<>();
        for (BarberDay day : loadBarberDays(barberRepository.findAllByOrderByIdAsc(), date)) {
            for (String slot : ALL_SLOTS) {
                if (!isBusy(LocalTime.parse(slot), day)) {
                    availableSlots.add(slot);
                }
            }
        }

        // Busy = all slots minus those where at least one barber is available
        return ALL_SLOTS.stream()
                .filter(slot -> !availableSlots.contains(slot))
                .toList();
    }

    /**
     * Busy grid slots for booking a service of {@code durationMinutes}: a slot is busy when the
     * booking rules ({@link #evaluate}) would reject that start time for this barber (or, for
     * the No Preference sentinel, for every barber). Unlike {@link #getBusySlots(String, String)}
     * this accounts for the service running into a later booking or past closing time.
     *
     * <p>Only used for services longer than the grid step ({@link #DEFAULT_DURATION_MINUTES}); for
     * those the start-minute-only answer would offer slots that the booking then rejects with 400.
     * Cached per barber, date and duration like the start-minute answer (an uncached call ran four
     * queries on every public request), and evicted with it: {@link AppointmentStatsService#clearAvailabilityCache}
     * removes the entry of every duration the catalog offers. Errors propagate and are never
     * cached, like the cached path.
     */
    @Cacheable(value = "busySlots",
            key = "#barberName + '-' + #bookingDate + '-' + #durationMinutes", sync = true)
    public List<String> getBusySlots(String barberName, String bookingDate, int durationMinutes) {
        LocalDate date = parseDate(bookingDate);
        List<BarberDay> days = AppointmentServiceImpl.NO_PREFERENCE_BARBER.equals(barberName)
                ? loadBarberDays(barberRepository.findAllByOrderByIdAsc(), date)
                : List.of(loadBarberDay(barberRepository.findByName(barberName)
                        .orElseThrow(() -> unknownBarber(barberName)), date));
        return ALL_SLOTS.stream()
                .filter(slot -> days.stream().allMatch(day ->
                        evaluate(day, LocalTime.parse(slot), durationMinutes, null).isPresent()))
                .toList();
    }

    /** Rule inputs of one named barber (its bookings are read with the per-barber query). */
    private BarberDay loadBarberDay(Barber barber, LocalDate date) {
        return loadBarberDays(List.of(barber), date, true).get(0);
    }

    /** Rule inputs of every candidate of a "No Preference" request (bookings of the whole date). */
    private List<BarberDay> loadBarberDays(List<Barber> barbers, LocalDate date) {
        return loadBarberDays(barbers, date, false);
    }

    /**
     * Loads the rule inputs of the given barbers for one date with a constant number of queries:
     * time off (one query), schedules for the weekday (one query) and the active appointments
     * (one query: of the single named barber, or of the whole date). The schedule and appointment
     * queries are skipped when no barber could take a booking anyway (all on time off, or none
     * scheduled). Returns one entry per barber, in the given order.
     */
    private List<BarberDay> loadBarberDays(List<Barber> barbers, LocalDate date, boolean singleNamedBarber) {
        if (barbers.isEmpty()) {
            return List.of();
        }
        List<Long> ids = barbers.stream().map(Barber::getId).toList();
        Set<Long> onTimeOff = new HashSet<>(barberTimeOffRepository.findBarberIdsOnTimeOff(ids, date));

        List<Long> working = ids.stream().filter(id -> !onTimeOff.contains(id)).toList();
        Map<Long, BarberSchedule> schedules = working.isEmpty() ? Map.of()
                : barberScheduleRepository.findForBarbersOnDay(working, date.getDayOfWeek().getValue()).stream()
                        .collect(Collectors.toMap(s -> s.getBarber().getId(), Function.identity()));

        Map<String, List<Appointment>> activeByBarber;
        if (schedules.isEmpty()) {
            activeByBarber = Map.of();
        } else if (singleNamedBarber) {
            String name = barbers.get(0).getName();
            activeByBarber = Map.of(name, appointmentRepository.findActiveForBarberOnDate(name, date));
        } else {
            activeByBarber = appointmentRepository.findActiveOnDate(date).stream()
                    .collect(Collectors.groupingBy(Appointment::getBarberName));
        }

        return barbers.stream()
                .map(barber -> new BarberDay(barber, onTimeOff.contains(barber.getId()),
                        schedules.get(barber.getId()),
                        activeByBarber.getOrDefault(barber.getName(), List.of())))
                .toList();
    }

    /**
     * Start-minute view used by the cached busy-slot lists: a slot is busy when the barber cannot
     * work that day (time off, not scheduled), it is outside the working window, or it is covered
     * by an active appointment.
     */
    private static boolean isBusy(LocalTime slot, BarberDay day) {
        BarberSchedule schedule = day.schedule();
        if (day.onTimeOff() || schedule == null) {
            return true;
        }
        if (slot.isBefore(schedule.getStartTime()) || !slot.isBefore(schedule.getEndTime())) {
            return true;
        }
        int minute = minuteOf(slot);
        for (Appointment other : day.active()) {
            if (startMinuteOf(other) <= minute && minute < endMinuteOf(other)) {
                return true;
            }
        }
        return false;
    }

    private static int minuteOf(LocalTime time) {
        return time.toSecondOfDay() / 60;
    }

    private static int startMinuteOf(Appointment appointment) {
        return minuteOf(LocalTime.parse(appointment.getBookingTime()));
    }

    /** End of an appointment's interval: its stored end time (NOT NULL since V35). */
    private static int endMinuteOf(Appointment appointment) {
        return minuteOf(appointment.getBookingEndTime());
    }

    private static LocalDate parseDate(String bookingDate) {
        if (bookingDate == null || bookingDate.isBlank()) {
            throw new IllegalArgumentException("Booking date is required (format YYYY-MM-DD).");
        }
        try {
            return LocalDate.parse(bookingDate.trim());
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("Invalid booking date. Expected a real date in the format YYYY-MM-DD.");
        }
    }

    static IllegalArgumentException unknownBarber(String barberName) {
        return new IllegalArgumentException("Unknown barber: '" + LogSanitizer.stripNewlines(barberName)
                + "'. Please select a barber from the list.");
    }
}
