package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface AppointmentService {
    AppointmentDashboardResponse getAllAppointments(String status, String searchName, int page, int size);
    AppointmentResponse getAppointmentById(Long id);
    org.springframework.data.domain.Page<AppointmentResponse> getMyAppointments(String email, int page, int size);
    void cancelMyAppointment(String publicId, String email);
    AppointmentCreationResult createAppointment(AppointmentCreateRequest request, String idempotencyKey);
    AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request);
    void deleteAppointment(Long id);
    java.util.List<String> getBusySlots(String barberName, String bookingDate);

    /** Busy slots for booking {@code serviceType} (null/blank = ignore the service's length). */
    java.util.List<String> getBusySlots(String barberName, String bookingDate, String serviceType);
    void publicCancelAppointment(String publicId, String email);
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
     * <p>Joins the caller's transaction, so the {@code reminderSent} flag and the caller's outbox
     * row commit (or roll back) together and the row lock is held only until that commit.
     */
    Optional<AppointmentDetails> claimReminder(Long id, LocalDate tomorrow);
}
