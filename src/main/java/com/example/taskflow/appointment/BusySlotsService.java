package com.example.taskflow.appointment;
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
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Barber availability rules and busy-slot calculation.
 * Extracted from AppointmentServiceImpl to prevent self-invocation cache bypass
 * and comply with ArchUnit rules against field injection.
 *
 * <p>An appointment occupies the half-open interval {@code [start, start + service duration)}.
 * A new booking is acceptable when its start is a grid slot, lies in the barber's working
 * window, its end does not pass closing time, the barber is not on time off, and its interval
 * overlaps no PENDING/APPROVED appointment of that barber. {@link #findConflict} is the single
 * implementation of those rules; booking creation, admin approval and "No Preference"
 * resolution all go through it.
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
     * Length assumed for a legacy appointment that has no service reference (one grid step),
     * so such a row still blocks at least its own slot.
     */
    public static final int DEFAULT_DURATION_MINUTES = 60;

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

        // 1. Barber on time off: every slot is busy (a legitimate, cacheable answer)
        if (!barberTimeOffRepository.findTimeOffForBarberOnDate(barber.getId(), date).isEmpty()) {
            return ALL_SLOTS;
        }

        // 2. Barber not scheduled that weekday: every slot is busy
        Optional<BarberSchedule> scheduleOpt = barberScheduleRepository
                .findByBarberIdAndDayOfWeek(barber.getId(), date.getDayOfWeek().getValue());
        if (scheduleOpt.isEmpty()) {
            return ALL_SLOTS;
        }

        // 3. Scheduled: busy = outside the working window or covered by an active appointment
        List<Appointment> active = appointmentRepository.findActiveForBarberOnDate(barber.getName(), date);
        return ALL_SLOTS.stream()
                .filter(slot -> isBusy(LocalTime.parse(slot), scheduleOpt.get(), active))
                .toList();
    }

    /**
     * The single availability rule set for placing (or re-validating) a booking.
     *
     * @param excludeAppointmentId a row to ignore when checking overlap (the appointment being
     *                             re-approved), or {@code null}
     * @return the reason the booking cannot be placed, or empty when it can
     */
    public Optional<String> findConflict(Barber barber, LocalDate date, LocalTime start,
                                         int durationMinutes, Long excludeAppointmentId) {
        List<Appointment> active = appointmentRepository.findActiveForBarberOnDate(barber.getName(), date);
        return findConflict(barber, date, start, durationMinutes, excludeAppointmentId, active);
    }

    private Optional<String> findConflict(Barber barber, LocalDate date, LocalTime start,
                                          int durationMinutes, Long excludeAppointmentId,
                                          List<Appointment> activeForBarber) {
        if (!barberTimeOffRepository.findTimeOffForBarberOnDate(barber.getId(), date).isEmpty()) {
            return Optional.of("The selected barber is unavailable on this date (time off). "
                    + "Please choose another date or barber.");
        }

        Optional<BarberSchedule> scheduleOpt = barberScheduleRepository
                .findByBarberIdAndDayOfWeek(barber.getId(), date.getDayOfWeek().getValue());
        if (scheduleOpt.isEmpty()) {
            return Optional.of("The selected barber is not scheduled to work on the requested date.");
        }
        BarberSchedule schedule = scheduleOpt.get();
        if (start.isBefore(schedule.getStartTime()) || !start.isBefore(schedule.getEndTime())) {
            return Optional.of("Booking time must be within the barber's working hours ("
                    + schedule.getStartTime() + "–" + schedule.getEndTime() + ").");
        }
        // Compare in minutes of the day: LocalTime.plusMinutes wraps past midnight.
        int startMinute = start.toSecondOfDay() / 60;
        if (startMinute + durationMinutes > schedule.getEndTime().toSecondOfDay() / 60) {
            return Optional.of("The selected service takes " + durationMinutes
                    + " minutes and would end after the barber's closing time ("
                    + schedule.getEndTime() + "). Please choose an earlier time.");
        }

        int endMinute = startMinute + durationMinutes;
        for (Appointment other : activeForBarber) {
            if (excludeAppointmentId != null && excludeAppointmentId.equals(other.getId())) {
                continue;
            }
            int otherStart = LocalTime.parse(other.getBookingTime()).toSecondOfDay() / 60;
            int otherEnd = otherStart + durationOf(other);
            if (otherStart < endMinute && startMinute < otherEnd) {
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
        List<Barber> barbers = barberRepository.findAll().stream()
                .sorted(Comparator.comparing(Barber::getId,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
        Map<String, List<Appointment>> activeByBarber = appointmentRepository.findActiveOnDate(date).stream()
                .collect(Collectors.groupingBy(Appointment::getBarberName));

        for (Barber barber : barbers) {
            List<Appointment> active = activeByBarber.getOrDefault(barber.getName(), List.of());
            if (findConflict(barber, date, requested, durationMinutes, null, active).isEmpty()) {
                return Optional.of(barber);
            }
        }
        return Optional.empty();
    }

    /** True when {@code bookingTime} (HH:mm) is one of the bookable grid slots. */
    public static boolean isGridSlot(String bookingTime) {
        return bookingTime != null && ALL_SLOTS.contains(bookingTime.trim());
    }

    /** Length of an appointment in minutes (its service's duration, or the grid step if unknown). */
    public static int durationOf(Appointment appointment) {
        if (appointment.getService() != null && appointment.getService().getDurationMinutes() != null
                && appointment.getService().getDurationMinutes() > 0) {
            return appointment.getService().getDurationMinutes();
        }
        return DEFAULT_DURATION_MINUTES;
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
        List<Barber> allBarbers = barberRepository.findAll();
        if (allBarbers.isEmpty()) {
            return ALL_SLOTS;
        }

        int dayOfWeek = date.getDayOfWeek().getValue();
        Map<String, List<Appointment>> activeByBarber = appointmentRepository.findActiveOnDate(date).stream()
                .collect(Collectors.groupingBy(Appointment::getBarberName));
        Set<String> availableSlots = new HashSet<>();

        for (Barber barber : allBarbers) {
            // Skip barbers on time off
            if (!barberTimeOffRepository.findTimeOffForBarberOnDate(barber.getId(), date).isEmpty()) {
                continue;
            }
            // Skip barbers not scheduled that day
            Optional<BarberSchedule> scheduleOpt =
                    barberScheduleRepository.findByBarberIdAndDayOfWeek(barber.getId(), dayOfWeek);
            if (scheduleOpt.isEmpty()) {
                continue;
            }
            List<Appointment> active = activeByBarber.getOrDefault(barber.getName(), List.of());
            for (String slot : ALL_SLOTS) {
                if (!isBusy(LocalTime.parse(slot), scheduleOpt.get(), active)) {
                    availableSlots.add(slot);
                }
            }
        }

        // Busy = all slots minus those where at least one barber is available
        return ALL_SLOTS.stream()
                .filter(slot -> !availableSlots.contains(slot))
                .toList();
    }

    /** A slot is busy when outside the working window or covered by an active appointment. */
    private static boolean isBusy(LocalTime slot, BarberSchedule schedule, List<Appointment> active) {
        if (slot.isBefore(schedule.getStartTime()) || !slot.isBefore(schedule.getEndTime())) {
            return true;
        }
        int minute = slot.toSecondOfDay() / 60;
        for (Appointment other : active) {
            int otherStart = LocalTime.parse(other.getBookingTime()).toSecondOfDay() / 60;
            if (otherStart <= minute && minute < otherStart + durationOf(other)) {
                return true;
            }
        }
        return false;
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

    private static IllegalArgumentException unknownBarber(String barberName) {
        return new IllegalArgumentException("Unknown barber: '" + LogSanitizer.stripNewlines(barberName)
                + "'. Please select a barber from the list.");
    }
}
