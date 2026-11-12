package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.CreationRequestFingerprint;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;
import com.example.taskflow.core.ConflictException;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Moves one existing row atomically; never cancels and recreates a booking. */
@Service
class AppointmentReschedulingService {
    private final AppointmentRepository repository;
    private final AppointmentOwnership ownership;
    private final BarberRepository barbers;
    private final BusySlotsService availability;
    private final AppointmentChangePublisher changes;
    private final ApplicationEventPublisher events;
    private final BookingProperties properties;
    private final Clock clock;

    AppointmentReschedulingService(AppointmentRepository repository, AppointmentOwnership ownership, BarberRepository barbers,
            BusySlotsService availability, AppointmentChangePublisher changes,
            ApplicationEventPublisher events, BookingProperties properties, Clock clock) {
        this.repository = repository;
        this.ownership = ownership;
        this.barbers = barbers;
        this.availability = availability;
        this.changes = changes;
        this.events = events;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * The grid slots of {@code date} the owner's booking cannot move to: outside the booking window,
     * already started, or refused by its barber's rules for its own booked length. The booking itself
     * does not count as busy, so it may move within its own interval, and a service renamed or
     * retired since the booking does not matter. Advisory only: {@link #reschedule} re-checks under
     * the barber's lock.
     */
    @Transactional(readOnly = true)
    public List<String> busySlots(String publicId, String email, LocalDate date) {
        Appointment item = ownership.requireOwned(publicId, email);
        LocalDateTime now = LocalDateTime.now(clock);
        requireMovable(item, now);
        Barber barber = requireAssignedBarber(item);
        if (date == null) {
            throw new IllegalArgumentException("Choose a date.");
        }
        LocalDate today = now.toLocalDate();
        if (date.isBefore(today) || date.isAfter(today.plusDays(properties.maxAdvanceDays()))) {
            return BusySlotsService.ALL_SLOTS;
        }
        Set<String> refused = new HashSet<>(
                availability.busySlotsForMove(barber, date, BusySlotsService.durationOf(item), item.getId()));
        return BusySlotsService.ALL_SLOTS.stream()
                .filter(slot -> refused.contains(slot) || !LocalDateTime.of(date, LocalTime.parse(slot)).isAfter(now))
                .toList();
    }

    @Transactional
    public AppointmentResponse reschedule(String publicId, String email, RescheduleRequest request,
            AppointmentRescheduledEvent.RescheduledBy actor) {
        Appointment item = ownership.requireOwned(publicId, email);
        LocalDateTime now = LocalDateTime.now(clock);
        LocalTime oldStart = LocalTime.parse(item.getBookingTime());
        requireMovable(item, now);
        if (request.bookingDate() == null || !BusySlotsService.isGridSlot(request.bookingTime())) {
            throw new IllegalArgumentException("Choose a date and an available booking time slot.");
        }
        LocalTime start = LocalTime.parse(request.bookingTime().trim());
        if (!LocalDateTime.of(request.bookingDate(), start).isAfter(now)) {
            throw new IllegalArgumentException("The appointment must be in the future.");
        }
        if (request.bookingDate().isAfter(now.toLocalDate().plusDays(properties.maxAdvanceDays()))) {
            throw new IllegalArgumentException("Appointments can be booked at most "
                    + properties.maxAdvanceDays() + " days in advance.");
        }
        Barber barber = barbers.findByIdForBooking(requireAssignedBarber(item).getId())
                .orElseThrow(() -> new ConflictException("The assigned barber is no longer available."));
        int duration = BusySlotsService.durationOf(item);
        availability.findConflict(barber, request.bookingDate(), start, duration, item.getId())
                .ifPresent(message -> { throw new ConflictException(message); });
        // A retry selecting the existing slot must not demote an already approved appointment.
        if (item.getBookingDate().equals(request.bookingDate()) && oldStart.equals(start)) {
            return AppointmentResponse.fromEntity(item);
        }

        AppointmentDetails previous = AppointmentDetails.of(item);
        if (item.getCreationRequestFingerprint() == null) {
            item.setCreationRequestFingerprint(CreationRequestFingerprint.of(item));
        }
        // Preserve the booked duration directly without touching the lazy ServiceItem proxy.
        item.setBookingSlot(request.bookingDate(), start.toString(), Appointment.endTimeOf(start, duration));
        item.setStatus(AppointmentStatus.PENDING);
        item.setReminderSent(false);
        try {
            repository.save(item);
            repository.flush();
        } catch (DataIntegrityViolationException ex) {
            if (SqlStates.isSlotConstraintViolation(ex)) {
                throw new ConflictException("The selected slot is already booked or unavailable.");
            }
            throw ex;
        } catch (OptimisticLockingFailureException | PessimisticLockingFailureException ex) {
            throw new ConflictException("The appointment or slot changed concurrently. Please refresh and retry.");
        }
        if (!previous.bookingDate().equals(item.getBookingDate())
                || !previous.barberName().equals(item.getBarberName())) {
            events.publishEvent(AvailabilityChangedEvent.single(previous.barberName(), previous.bookingDate()));
        }
        changes.availabilityChanged(item);
        events.publishEvent(new AppointmentRescheduledEvent(previous, AppointmentDetails.of(item), actor));
        changes.adminEvent(AppointmentAdminEvent.Type.UPDATED, item.getId());
        return AppointmentResponse.fromEntity(item);
    }

    private static void requireMovable(Appointment item, LocalDateTime now) {
        LocalTime start = LocalTime.parse(item.getBookingTime());
        if ((item.getStatusEnum() != AppointmentStatus.PENDING && item.getStatusEnum() != AppointmentStatus.APPROVED)
                || !LocalDateTime.of(item.getBookingDate(), start).isAfter(now)) {
            throw new ConflictException("Only future pending or approved appointments can be rescheduled.");
        }
    }

    private static Barber requireAssignedBarber(Appointment item) {
        if (item.getBarber() == null || AppointmentBookingService.NO_PREFERENCE_BARBER.equals(item.getBarberName())) {
            throw new ConflictException("This appointment has no assigned barber and cannot be rescheduled.");
        }
        return item.getBarber();
    }
}
