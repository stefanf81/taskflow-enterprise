package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

@Service
public class BarberServiceImpl implements BarberService {

    private static final Logger logger = LoggerFactory.getLogger(BarberServiceImpl.class);
    /** Safety cap on the per-time-off cache-eviction loop to avoid pathological ranges. */
    private static final int MAX_EVICT_DAYS = 366;

    private final BarberRepository barberRepository;
    private final BarberScheduleRepository scheduleRepository;
    private final BarberTimeOffRepository timeOffRepository;
    private final AppointmentStatsService statsService;

    public BarberServiceImpl(BarberRepository barberRepository,
                             BarberScheduleRepository scheduleRepository,
                             BarberTimeOffRepository timeOffRepository,
                             AppointmentStatsService statsService) {
        this.barberRepository = barberRepository;
        this.scheduleRepository = scheduleRepository;
        this.timeOffRepository = timeOffRepository;
        this.statsService = statsService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<BarberResponse> getAllBarbers() {
        return barberRepository.findAllProjectedBy();
    }

    @Override
    @Transactional
    public BarberResponse createBarber(BarberRequest request) {
        Barber saved = barberRepository.save(request.toEntity());
        return BarberResponse.fromEntity(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public List<BarberTimeOffResponse> getTimeOff(Long barberId) {
        return timeOffRepository.findByBarberId(barberId).stream()
                .map(BarberTimeOffResponse::fromEntity)
                .toList();
    }

    @Override
    @Transactional
    public BarberTimeOffResponse addTimeOff(Long barberId, BarberTimeOffRequest request) {
        Barber barber = barberRepository.findById(barberId)
                .orElseThrow(() -> new ResourceNotFoundException("Barber not found with id: " + barberId));
        if (!request.isDateRangeValid()) {
            throw new IllegalArgumentException("End date must not be before start date.");
        }
        BarberTimeOff saved = timeOffRepository.save(request.toEntity(barber));

        // Eagerly evict the busy-slots cache for every affected date so a
        // freshly-added time-off immediately blocks bookings instead of waiting
        // up to 2 minutes for the cached entry to expire. Without this, an
        // admin marking a barber unavailable could see the slot remain bookable.
        evictBusySlotsCacheForRange(barber.getName(), request.startDate(), request.endDate());

        return BarberTimeOffResponse.fromEntity(saved);
    }

    private void evictBusySlotsCacheForRange(String barberName, LocalDate startDate, LocalDate endDate) {
        if (startDate == null || endDate == null) {
            return;
        }
        LocalDate date = startDate;
        int count = 0;
        while (!date.isAfter(endDate) && count < MAX_EVICT_DAYS) {
            statsService.clearBusySlotsCache(barberName, date);
            date = date.plusDays(1);
            count++;
        }
        if (!date.isAfter(endDate)) {
            logger.warn("Busy-slot cache eviction for barber {} capped at {} days (range exceeded the limit).",
                    barberName, MAX_EVICT_DAYS);
        }
    }
}