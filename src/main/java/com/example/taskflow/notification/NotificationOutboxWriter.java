package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

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

    @Async
    @EventListener
    @Transactional
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
            String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
            logger.error("Failed to enqueue status-change notification: {}", safeMsg);
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
