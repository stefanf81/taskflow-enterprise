package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Service to handle barber busy slot calculations.
 * Extracted from AppointmentServiceImpl to prevent self-invocation cache bypass
 * and comply with ArchUnit rules against field injection.
 */
@Service
@Transactional(readOnly = true)
public class BusySlotsService {

    private static final Logger logger = LoggerFactory.getLogger(BusySlotsService.class);

    /**
     * All possible operating time slots (09:00 - 17:00, with a 1-hour lunch break at 12:00).
     * Synchronized with shared frontend/mobile tokens (DEFAULT_TIME_SLOTS).
     */
    public static final List<String> ALL_SLOTS =
            List.of("09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00");

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

    @Cacheable(value = "busySlots", key = "#barberName + '-' + #bookingDate", sync = true)
    public List<String> getBusySlots(String barberName, String bookingDate) {
        if (bookingDate == null || bookingDate.trim().isEmpty() || bookingDate.length() < 10) {
            return java.util.Collections.emptyList();
        }
        LocalDate date;
        try {
            date = LocalDate.parse(bookingDate);
        } catch (java.time.format.DateTimeParseException e) {
            return java.util.Collections.emptyList();
        }

        try {
            // H3: "No Preference" sentinel must aggregate across ALL barbers.
            // A slot is busy (unavailable) only when NO working barber can accept it.
            // Previously the sentinel fell through to findDistinctBookingTimes with
            // the sentinel string itself, which returned empty — making ALL slots
            // appear available even if every real barber was fully booked.
            if (AppointmentServiceImpl.NO_PREFERENCE_BARBER.equals(barberName)) {
                return computeNoPreferenceBusySlots(date);
            }

            // Check if Barber exists
            Optional<Barber> barberOpt = barberRepository.findByName(barberName);
            if (barberOpt.isPresent()) {
                Barber barber = barberOpt.get();

                // 1. Check if barber has time off on this date
                List<BarberTimeOff> timeOffs = barberTimeOffRepository.findTimeOffForBarberOnDate(barber.getId(), date);
                if (!timeOffs.isEmpty()) {
                    // Barber is off, return all possible slots as busy
                    return ALL_SLOTS;
                }

                // 2. Check if barber is scheduled to work on this day of week
                int dayOfWeek = date.getDayOfWeek().getValue();
                Optional<BarberSchedule> scheduleOpt = barberScheduleRepository.findByBarberIdAndDayOfWeek(barber.getId(), dayOfWeek);
                if (scheduleOpt.isEmpty()) {
                    // Not scheduled to work, return all possible slots as busy
                    return ALL_SLOTS;
                }
            }

            // 3. Barber is scheduled and not off
            return appointmentRepository.findDistinctBookingTimes(barberName, date, AppointmentStatus.DENIED);
        } catch (Exception e) {
            // H12: On any failure, return ALL_SLOTS as a conservative safe default.
            // Returning empty list would incorrectly show "all slots available",
            // potentially allowing bookings during system errors.
            logger.error("Error computing busy slots for {} on {}: {}", LogSanitizer.mask(barberName),
                    LogSanitizer.mask(bookingDate), LogSanitizer.safeMessage(e), e);
            return ALL_SLOTS;
        }
    }

    /**
     * H3: Compute busy slots for the "No Preference (First Available)" sentinel.
     *
     * <p>A slot is considered busy (unavailable) only when NO working barber can
     * accept it — meaning every barber is either on time off, not scheduled that
     * day, or already booked at that time. If at least one working barber is free
     * at a given slot, that slot remains available for the "No Preference" booking.
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
        Set<String> availableSlots = new HashSet<>();

        for (Barber barber : allBarbers) {
            // Skip barbers on time off
            if (!barberTimeOffRepository.findTimeOffForBarberOnDate(barber.getId(), date).isEmpty()) {
                continue;
            }
            // Skip barbers not scheduled that day
            if (barberScheduleRepository.findByBarberIdAndDayOfWeek(barber.getId(), dayOfWeek).isEmpty()) {
                continue;
            }
            // This barber is working — collect slots they're NOT already booked for
            List<String> bookedTimes = appointmentRepository.findDistinctBookingTimes(
                    barber.getName(), date, AppointmentStatus.DENIED);
            for (String slot : ALL_SLOTS) {
                if (!bookedTimes.contains(slot)) {
                    availableSlots.add(slot);
                }
            }
        }

        // Busy = all slots minus those where at least one barber is available
        return ALL_SLOTS.stream()
                .filter(slot -> !availableSlots.contains(slot))
                .toList();
    }
}
