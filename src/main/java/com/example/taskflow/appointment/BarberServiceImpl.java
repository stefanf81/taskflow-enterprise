package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class BarberServiceImpl implements BarberService {

    private final BarberRepository barberRepository;
    private final BarberScheduleRepository scheduleRepository;
    private final BarberTimeOffRepository timeOffRepository;

    public BarberServiceImpl(BarberRepository barberRepository,
                             BarberScheduleRepository scheduleRepository,
                             BarberTimeOffRepository timeOffRepository) {
        this.barberRepository = barberRepository;
        this.scheduleRepository = scheduleRepository;
        this.timeOffRepository = timeOffRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<BarberResponse> getAllBarbers() {
        return barberRepository.findAllProjectedBy();
    }

    @Override
    @Transactional
    public Barber createBarber(BarberRequest request) {
        return barberRepository.save(request.toEntity());
    }

    @Override
    @Transactional(readOnly = true)
    public List<BarberTimeOff> getTimeOff(Long barberId) {
        return timeOffRepository.findByBarberId(barberId);
    }

    @Override
    @Transactional
    public BarberTimeOff addTimeOff(Long barberId, BarberTimeOffRequest request) {
        Barber barber = barberRepository.findById(barberId)
                .orElseThrow(() -> new ResourceNotFoundException("Barber not found with id: " + barberId));
        if (!request.isDateRangeValid()) {
            throw new IllegalArgumentException("End date must not be before start date.");
        }
        return timeOffRepository.save(request.toEntity(barber));
    }
}
