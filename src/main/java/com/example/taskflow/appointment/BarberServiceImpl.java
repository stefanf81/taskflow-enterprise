package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class BarberServiceImpl implements BarberService {

    private final BarberRepository barberRepository;
    private final BarberScheduleRepository scheduleRepository;
    private final BarberTimeOffRepository timeOffRepository;
    private final ApplicationEventPublisher eventPublisher;

    public BarberServiceImpl(BarberRepository barberRepository,
                             BarberScheduleRepository scheduleRepository,
                             BarberTimeOffRepository timeOffRepository,
                             ApplicationEventPublisher eventPublisher) {
        this.barberRepository = barberRepository;
        this.scheduleRepository = scheduleRepository;
        this.timeOffRepository = timeOffRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional(readOnly = true)
    @Cacheable(value = "publicBarbers", sync = true)
    public List<PublicBarberResponse> getPublicBarbers() {
        return barberRepository.findAllPublicProjectedBy();
    }

    @Override
    @Transactional(readOnly = true)
    @Cacheable(value = "barbers", sync = true)
    public List<BarberResponse> getAllBarbers() {
        return barberRepository.findAllProjectedBy();
    }

    @Override
    @Transactional
    @CacheEvict(value = {"barbers", "publicBarbers"}, allEntries = true)
    public BarberResponse createBarber(BarberRequest request) {
        Barber saved = barberRepository.save(request.toEntity());
        // A new barber can serve every date, so the "First Available" aggregate
        // is stale for every date. Invalidate the whole availability cache
        // (after commit, via the listener) rather than enumerating dates.
        eventPublisher.publishEvent(AvailabilityChangedEvent.allBarbers());
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

        // Invalidate the busy-slots cache for every affected date after commit so
        // a freshly-added time-off immediately blocks bookings instead of waiting
        // up to 2 minutes for the cached entry to expire. The listener evicts both
        // the concrete barber key and the "First Available" aggregate.
        eventPublisher.publishEvent(
                AvailabilityChangedEvent.range(barber.getName(), request.startDate(), request.endDate()));

        return BarberTimeOffResponse.fromEntity(saved);
    }
}
