package com.example.taskflow.appointment;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * The appointment module's API for other modules: exactly what {@code review} (booking lookup) and
 * {@code notification} (24-hour reminders) call. It hands out {@link AppointmentDetails} snapshots
 * and ids, never the {@code Appointment} entity (ADR-022). The review ratings follow the
 * appointments through {@link AppointmentStatusChangedEvent} and {@link AppointmentCancelledEvent}.
 *
 * <p>Booking, the status lifecycle and the admin/customer listings are not part of it: they are the
 * package-private {@code AppointmentBookingService}, {@code AppointmentLifecycleService} and
 * {@code AppointmentQueryService}, used only by this module's controllers.
 */
public interface AppointmentService {

    /** Read-only view of the booking with this public id; empty when none exists. */
    Optional<AppointmentDetails> findDetailsByPublicId(String publicId);

    /**
     * Returns the IDs of APPROVED appointments scheduled for {@code tomorrow}
     * that have not yet had their 24-hour reminder enqueued.
     *
     * <p>Public module API consumed by the notification module's
     * {@code AppointmentReminderScheduler} so the notification slice never
     * reaches into the appointment module's internal {@code AppointmentRepository}
     * (Spring Modulith boundary).
     */
    List<Long> findAppointmentIdsNeedingReminders(LocalDate tomorrow);

    /**
     * Claims the 24-hour reminder for one appointment: loads it with a {@code PESSIMISTIC_WRITE}
     * lock, re-checks under the lock that it is still APPROVED, scheduled for {@code tomorrow}
     * and not yet reminded, then marks the reminder as sent and returns the booking so the caller
     * can enqueue the e-mail. Empty when there is nothing to remind about.
     *
     * <p>Requires the caller's transaction ({@code Propagation.MANDATORY}; it throws without one),
     * so the {@code reminderSent} flag and the caller's outbox row commit (or roll back) together
     * and the row lock is held only until that commit.
     */
    Optional<AppointmentDetails> claimReminder(Long id, LocalDate tomorrow);
}
