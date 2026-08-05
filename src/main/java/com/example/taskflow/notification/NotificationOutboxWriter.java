package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * C3: Enqueues a PENDING notification row whenever an appointment status changes.
 *
 * <p>Kept in the notification slice (it only consumes the appointment slice's
 * {@link AppointmentStatusChangedEvent}, so the dependency stays one-way and the
 * ArchUnit slice-cycle rule is satisfied). The {@link NotificationRelayScheduler}
 * later performs the (simulated) send and records the truthful outcome.
 */
@Component
public class NotificationOutboxWriter {

    private static final Logger logger = LoggerFactory.getLogger(NotificationOutboxWriter.class);
    private final NotificationOutboxRepository outboxRepository;

    public NotificationOutboxWriter(NotificationOutboxRepository outboxRepository) {
        this.outboxRepository = outboxRepository;
    }

    /**
     * Synchronously enqueues an outbox row within the caller's transaction — if the
     * outbox save fails, the entire transaction rolls back atomically.
     */
    @EventListener
    public void handleAppointmentStatusChanged(AppointmentStatusChangedEvent event) {
        Appointment appointment = event.getAppointment();
        try {
            NotificationOutbox outbox = new NotificationOutbox(
                    safe(appointment.getCustomerEmail()),
                    "EMAIL",
                    buildStatusChangeMessage(appointment),
                    LocalDateTime.now(),
                    "PENDING");
            outboxRepository.save(outbox);
        } catch (Exception e) {
            String safeMsg = LogSanitizer.safeMessage(e);
            logger.error("Failed to enqueue status-change notification: {}", safeMsg);
            // Rethrow so the async error handler sees this and the transaction
            // rolls back — the NotificationRelayScheduler will retry from its own sweep.
            throw new RuntimeException("Failed to enqueue notification", e);
        }
    }

    private static String safe(String value) {
        return value != null ? value.replaceAll("[\\r\\n]", "") : "";
    }

    private String buildStatusChangeMessage(Appointment appointment) {
        String name = safe(appointment.getCustomerName());
        String barber = safe(appointment.getBarberName());
        String service = safe(appointment.getServiceType());
        String date = appointment.getBookingDate() != null ? appointment.getBookingDate().toString() : "";
        String time = safe(appointment.getBookingTime());
        String status = safe(appointment.getStatus());

        String subject;
        String content;
        if ("APPROVED".equalsIgnoreCase(status)) {
            subject = "Appointment APPROVED";
            content = String.format("Dear %s, your %s appointment with %s on %s at %s has been APPROVED.",
                    name, service, barber, date, time);
        } else if ("DENIED".equalsIgnoreCase(status)) {
            subject = "Appointment DECLINED";
            content = String.format("Dear %s, unfortunately we could not accommodate your %s appointment with %s on %s at %s. Please try booking another slot.",
                    name, service, barber, date, time);
        } else {
            subject = "Appointment Update";
            content = String.format("Dear %s, your appointment status has been updated to: %s.",
                    name, status);
        }
        return "Subject: " + subject + " - " + content;
    }
}
