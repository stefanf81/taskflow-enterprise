package com.example.taskflow.appointment;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * Service to handle barber busy slot calculations.
 * Extracted from AppointmentServiceImpl to prevent self-invocation cache bypass
 * and comply with ArchUnit rules against field injection.
 */
@Service
@Transactional(readOnly = true)
public class BusySlotsService {

    private static final Logger logger = LoggerFactory.getLogger(BusySlotsService.class);

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
        try {
            LocalDate date = LocalDate.parse(bookingDate);

            // Check if Barber exists
            Optional<Barber> barberOpt = barberRepository.findByName(barberName);
            if (barberOpt.isPresent()) {
                Barber barber = barberOpt.get();

                // 1. Check if barber has time off on this date
                List<BarberTimeOff> timeOffs = barberTimeOffRepository.findTimeOffForBarberOnDate(barber.getId(), date);
                if (!timeOffs.isEmpty()) {
                    // Barber is off, return all possible slots as busy
                    return Arrays.asList("09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00");
                }

                // 2. Check if barber is scheduled to work on this day of week
                int dayOfWeek = date.getDayOfWeek().getValue();
                Optional<BarberSchedule> scheduleOpt = barberScheduleRepository.findByBarberIdAndDayOfWeek(barber.getId(), dayOfWeek);
                if (scheduleOpt.isEmpty()) {
                    // Not scheduled to work, return all possible slots as busy
                    return Arrays.asList("09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00");
                }
            }

            // 3. Barber is scheduled and not off
            return appointmentRepository.findDistinctBookingTimes(barberName, date, "DENIED");
        } catch (Exception e) {
            logger.error("Error parsing bookingDate in getBusySlots: {}", maskInput(bookingDate), e);
            return Collections.emptyList();
        }
    }

    private String maskInput(String input) {
        if (input == null || input.length() <= 4) {
            return "****";
        }
        String sanitized = input.replaceAll("[\\r\\n]", "");
        if (sanitized.length() <= 4) {
            return "****";
        }
        return sanitized.substring(0, 2) + "****" + sanitized.substring(sanitized.length() - 2);
    }
}
