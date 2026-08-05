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
    AppointmentResponse createAppointment(AppointmentCreateRequest request, String idempotencyKey);
    AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request);
    void deleteAppointment(Long id);
    java.util.List<String> getBusySlots(String barberName, String bookingDate);
    void publicCancelAppointment(String publicId, String email);
    Appointment findByPublicId(String publicId);

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
     * Loads a single appointment with a {@code PESSIMISTIC_WRITE} lock so the
     * reminder writer can mark {@code reminderSent = true} and commit per row
     * without holding locks across multiple appointments.
     *
     * <p>Designed to be called from a {@code @Transactional} method on the
     * caller side so the lock is released on the caller's transaction commit
     * (same propagation semantics as the previous direct repository call).
     */
    Optional<Appointment> lockForReminder(Long id);

    /**
     * Persists the (mutated) appointment entity — used by reminder writers to
     * flip {@code reminderSent} on a previously locked row.
     */
    void save(Appointment appointment);
}
