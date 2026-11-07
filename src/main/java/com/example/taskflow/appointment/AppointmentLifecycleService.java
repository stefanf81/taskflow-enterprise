package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Optional;

/**
 * Status lifecycle of an existing booking: admin approve/deny, the soft cancel by an admin
 * ({@code DELETE}), a guest (public id + e-mail) or the signed-in customer.
 *
 * <p>Allowed admin transitions are PENDING -> APPROVED|DENIED, APPROVED -> DENIED and DENIED ->
 * APPROVED; an approval re-runs the full availability check. The same status is a silent no-op;
 * anything else, or anything on a CANCELLED booking, is a 409 ({@link InvalidStatusTransitionException}).
 */
@Service
class AppointmentLifecycleService {

    private final AppointmentRepository appointmentRepository;
    private final AppointmentChangePublisher changes;
    private final BusySlotsService busySlotsService;
    private final BarberRepository barberRepository;
    private final Clock clock;

    AppointmentLifecycleService(AppointmentRepository appointmentRepository,
                                AppointmentChangePublisher changes,
                                BusySlotsService busySlotsService,
                                BarberRepository barberRepository,
                                Clock clock) {
        this.appointmentRepository = appointmentRepository;
        this.changes = changes;
        this.busySlotsService = busySlotsService;
        this.barberRepository = barberRepository;
        this.clock = clock;
    }

    @Transactional
    public AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));

        AppointmentStatus current = item.getStatusEnum();
        AppointmentStatus target = AppointmentStatus.fromString(request.status());

        // A cancelled booking is final: its slot may already belong to someone else.
        if (current == AppointmentStatus.CANCELLED) {
            throw new InvalidStatusTransitionException(current.name(), target.name());
        }
        // Same status: nothing to do - no write, no event, no e-mail to the customer.
        if (current == target) {
            return AppointmentResponse.fromEntity(item);
        }
        if (!isAllowedTransition(current, target)) {
            throw new InvalidStatusTransitionException(current.name(), target.name());
        }
        if (target == AppointmentStatus.APPROVED) {
            // PENDING -> APPROVED and DENIED -> APPROVED both put the booking on the calendar,
            // so the full availability check runs again (the slot of a DENIED booking may have
            // been re-booked, the barber may have gone on leave, the time may have passed).
            requireCanApprove(item);
        }

        item.setStatus(target);
        Appointment savedItem = appointmentRepository.save(item);
        if (target == AppointmentStatus.APPROVED) {
            flushApproval();
        }
        changes.availabilityChanged(savedItem);

        changes.tagSpan(
            "appointment.id", String.valueOf(savedItem.getId()),
            "appointment.status", savedItem.getStatus()
        );

        // The notification outbox entry is written by the notification module's listener.
        changes.statusChanged(this, savedItem);
        changes.adminEvent(AppointmentAdminEvent.Type.UPDATED, savedItem.getId());

        return AppointmentResponse.fromEntity(savedItem);
    }

    /**
     * Writes an approval immediately instead of at commit. DENIED -> APPROVED puts the booking back
     * on the calendar; a booking that raced into the slot after {@link #requireCanApprove} is caught
     * by the active-slot unique index (23505) or the PostgreSQL exclusion constraint (23P01), and is
     * reported as the same 409 the in-transaction check gives instead of a generic data conflict.
     */
    private void flushApproval() {
        try {
            appointmentRepository.flush();
        } catch (DataIntegrityViolationException ex) {
            if (SqlStates.isSlotConstraintViolation(ex)) {
                throw new ConflictException("The selected slot is already booked or unavailable.");
            }
            throw ex;
        }
    }

    /** PENDING -> APPROVED|DENIED, APPROVED -> DENIED, DENIED -> APPROVED. */
    private static boolean isAllowedTransition(AppointmentStatus from, AppointmentStatus to) {
        return switch (from) {
            case PENDING -> to == AppointmentStatus.APPROVED || to == AppointmentStatus.DENIED;
            case APPROVED -> to == AppointmentStatus.DENIED;
            case DENIED -> to == AppointmentStatus.APPROVED;
            case CANCELLED -> false;
        };
    }

    /**
     * Re-validates a booking before it is (re-)approved. Every refusal is a 409: the request
     * is well-formed, but the booking's current state no longer allows it.
     */
    private void requireCanApprove(Appointment item) {
        Barber barber = item.getBarber();
        if (barber == null || AppointmentBookingService.NO_PREFERENCE_BARBER.equals(item.getBarberName())) {
            throw new ConflictException("This appointment has no assigned barber and cannot be approved. "
                    + "Deny or cancel it instead.");
        }
        barber = barberRepository.findByIdForBooking(barber.getId())
                .orElseThrow(() -> new ConflictException("The assigned barber is no longer available."));
        LocalTime start = LocalTime.parse(item.getBookingTime());
        if (!LocalDateTime.of(item.getBookingDate(), start).isAfter(LocalDateTime.now(clock))) {
            throw new ConflictException("A past appointment cannot be approved.");
        }
        busySlotsService.findConflict(barber, item.getBookingDate(), start,
                        BusySlotsService.durationOf(item), item.getId())
                .ifPresent(message -> {
                    throw new ConflictException(message);
                });
    }

    /** Admin DELETE: soft-cancels (the row is kept as CANCELLED). Past bookings may be cancelled by an admin. */
    @Transactional
    public void deleteAppointment(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        cancelAppointment(item, AppointmentCancelledEvent.CancelledBy.ADMIN, false);
    }

    /** Guest cancel: the public id plus the booking's e-mail address. */
    @Transactional
    public void publicCancelAppointment(String publicId, String email) {
        Appointment item = appointmentRepository.findByPublicId(publicId);
        if (item == null) {
            throw new ResourceNotFoundException("Appointment booking not found.");
        }
        if (!item.getCustomerEmail().equalsIgnoreCase(email.trim())) {
            throw new IllegalArgumentException("Verification failed: The provided email address does not match this booking ID.");
        }
        cancelAppointment(item, AppointmentCancelledEvent.CancelledBy.GUEST, true);
    }

    /** Signed-in customer cancel: someone else's booking reads as not found. */
    @Transactional
    public void cancelMyAppointment(String publicId, String email) {
        Appointment appointment = Optional.ofNullable(appointmentRepository.findByPublicId(publicId))
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found or unauthorized."));
        if (!appointment.getCustomerEmail().equalsIgnoreCase(email)) {
            throw new ResourceNotFoundException("Appointment not found or unauthorized.");
        }
        cancelAppointment(appointment, AppointmentCancelledEvent.CancelledBy.CUSTOMER, true);
    }

    /**
     * Soft-cancels an appointment: status becomes CANCELLED, the slot is released (the active-slot
     * index ignores CANCELLED), the idempotency key and any review stay on the row, and the
     * customer is notified through {@link AppointmentCancelledEvent}.
     *
     * <ul>
     *   <li>already CANCELLED: idempotent no-op (no second e-mail);</li>
     *   <li>DENIED: 400 - there is nothing to cancel;</li>
     *   <li>{@code enforceNotPast}: customers and guests cannot cancel a booking that has started.</li>
     * </ul>
     */
    private void cancelAppointment(Appointment item, AppointmentCancelledEvent.CancelledBy cancelledBy,
                                   boolean enforceNotPast) {
        AppointmentStatus current = item.getStatusEnum();
        if (current == AppointmentStatus.CANCELLED) {
            return;
        }
        if (current == AppointmentStatus.DENIED) {
            throw new IllegalArgumentException("A declined appointment cannot be cancelled.");
        }
        if (enforceNotPast && !startOf(item).isAfter(LocalDateTime.now(clock))) {
            throw new IllegalArgumentException(
                    "This appointment has already started or passed and can no longer be cancelled online.");
        }

        item.setStatus(AppointmentStatus.CANCELLED);
        Appointment saved = appointmentRepository.save(item);
        changes.cancelled(saved, cancelledBy);
        changes.availabilityChanged(saved);
        changes.adminEvent(AppointmentAdminEvent.Type.UPDATED, saved.getId());

        changes.tagSpan(
            "appointment.id", String.valueOf(saved.getId()),
            "appointment.action", "cancel",
            "appointment.cancelledBy", cancelledBy.name()
        );
    }

    private static LocalDateTime startOf(Appointment item) {
        return LocalDateTime.of(item.getBookingDate(), LocalTime.parse(item.getBookingTime()));
    }
}
