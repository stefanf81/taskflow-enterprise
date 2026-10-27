package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

@Service
class BarberServiceImpl implements BarberService {

    private static final Logger logger = LoggerFactory.getLogger(BarberServiceImpl.class);

    private final BarberRepository barberRepository;
    private final BarberScheduleRepository scheduleRepository;
    private final BarberTimeOffRepository timeOffRepository;
    private final AppointmentRepository appointmentRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final BookingProperties bookingProperties;

    public BarberServiceImpl(BarberRepository barberRepository,
                             BarberScheduleRepository scheduleRepository,
                             BarberTimeOffRepository timeOffRepository,
                             AppointmentRepository appointmentRepository,
                             ApplicationEventPublisher eventPublisher,
                             Clock clock,
                             BookingProperties bookingProperties) {
        this.barberRepository = barberRepository;
        this.scheduleRepository = scheduleRepository;
        this.timeOffRepository = timeOffRepository;
        this.appointmentRepository = appointmentRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
        this.bookingProperties = bookingProperties;
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
        // The booking flow treats this exact name as "any barber" and never stores it, so a real
        // barber carrying it could be neither booked by name nor approved.
        if (AppointmentServiceImpl.NO_PREFERENCE_BARBER.equalsIgnoreCase(request.name().trim())) {
            throw new IllegalArgumentException("'" + AppointmentServiceImpl.NO_PREFERENCE_BARBER
                    + "' is reserved and cannot be used as a barber name.");
        }
        Barber saved = barberRepository.save(request.toEntity());
        // A barber without schedule rows is "not scheduled" on every day and could never be
        // booked. Give the new barber the default shift (app.booking.default-*), which
        // matches the seeded barbers (Mon-Sat 09:00-17:00); the admin can adjust it later.
        List<BarberSchedule> schedules = new ArrayList<>();
        for (Integer dayOfWeek : bookingProperties.defaultWorkingDays()) {
            BarberSchedule schedule = new BarberSchedule();
            schedule.setBarber(saved);
            schedule.setDayOfWeek(dayOfWeek);
            schedule.setStartTime(bookingProperties.shiftStart());
            schedule.setEndTime(bookingProperties.shiftEnd());
            schedules.add(schedule);
        }
        scheduleRepository.saveAll(schedules);
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

        // Bookings that fall inside the new time off can no longer be served: cancel them
        // (customers are e-mailed through the cancellation event). Dates already in the past
        // are left alone, as are earlier hours of today.
        int cancelled = cancelBookingsDuringTimeOff(barber, request.startDate(), request.endDate());
        logger.info("Time off for barber id {} from {} to {} cancelled {} booking(s).",
                barber.getId(), request.startDate(), request.endDate(), cancelled);

        // Invalidate the busy-slots cache for every affected date after commit so
        // a freshly-added time-off immediately blocks bookings instead of waiting
        // up to 2 minutes for the cached entry to expire. The listener evicts both
        // the concrete barber key and the "First Available" aggregate.
        eventPublisher.publishEvent(
                AvailabilityChangedEvent.range(barber.getName(), request.startDate(), request.endDate()));

        return BarberTimeOffResponse.fromEntity(saved);
    }

    private int cancelBookingsDuringTimeOff(Barber barber, LocalDate startDate, LocalDate endDate) {
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDate from = startDate.isBefore(now.toLocalDate()) ? now.toLocalDate() : startDate;
        if (endDate.isBefore(from)) {
            return 0;
        }
        int count = 0;
        for (Appointment appointment : appointmentRepository
                .findActiveForBarberInRange(barber.getName(), from, endDate)) {
            LocalDateTime start = LocalDateTime.of(
                    appointment.getBookingDate(), LocalTime.parse(appointment.getBookingTime()));
            if (!start.isAfter(now)) {
                continue;
            }
            appointment.setStatus(AppointmentStatus.CANCELLED);
            Appointment saved = appointmentRepository.save(appointment);
            eventPublisher.publishEvent(new AppointmentCancelledEvent(
                    AppointmentDetails.of(saved), AppointmentCancelledEvent.CancelledBy.BARBER_UNAVAILABLE));
            eventPublisher.publishEvent(new AppointmentAdminEvent(
                    AppointmentAdminEvent.Type.UPDATED, saved.getId(), Instant.now(clock)));
            count++;
        }
        return count;
    }
}
