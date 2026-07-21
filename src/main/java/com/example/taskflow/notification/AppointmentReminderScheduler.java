package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Component
public class AppointmentReminderScheduler {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentReminderScheduler.class);
    
    private final AppointmentRepository appointmentRepository;
    private final NotificationOutboxRepository notificationOutboxRepository;

    public AppointmentReminderScheduler(AppointmentRepository appointmentRepository, NotificationOutboxRepository notificationOutboxRepository) {
        this.appointmentRepository = appointmentRepository;
        this.notificationOutboxRepository = notificationOutboxRepository;
    }

    // Runs every 15 minutes. The outer sweep is NOT transactional: it only loads
    // the IDs that need a reminder, then processes each appointment in its own
    // transaction (see processOne). A5: previously the entire loop ran under a
    // single PESSIMISTIC_WRITE transaction, locking every matching row for the
    // whole sweep. Now the row lock is acquired and released per appointment.
    @Scheduled(fixedRate = 900000) // 15 minutes
    public void processReminders() {
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        logger.info("Scanning for appointments needing 24-hour reminders for date: {}", tomorrow);

        List<Long> upcomingAppointmentIds = appointmentRepository.findReminderIds(tomorrow, false, "APPROVED");

        int processed = 0;
        for (Long appointmentId : upcomingAppointmentIds) {
            try {
                processOne(appointmentId);
                processed++;
            } catch (Exception e) {
                String safeMsg = LogSanitizer.safeMessage(e);
                logger.error("Failed to process reminder for appointment {}: {}", appointmentId, safeMsg);
            }
        }
        
        logger.info("Processed {} reminders.", processed);
    }

    @Transactional
    public void processOne(Long appointmentId) {
        // A5: re-load the single row with a PESSIMISTIC_WRITE lock inside this
        // dedicated transaction so the lock is held only for this appointment and
        // released on commit — not for the whole sweep.
        Appointment appointment = appointmentRepository.findByIdForUpdate(appointmentId).orElse(null);
        if (appointment == null || Boolean.TRUE.equals(appointment.getReminderSent())) {
            return;
        }

        String safeEmail = appointment.getCustomerEmail() != null ? appointment.getCustomerEmail().replaceAll("[\\r\\n]", "") : "";
        logger.info("Sending reminder to {} for appointment on {}", safeEmail, appointment.getBookingDate());
        
        // Mock sending email
        String message = String.format("Hi %s, this is a reminder for your %s appointment with %s tomorrow at %s.",
                appointment.getCustomerName(), appointment.getServiceType(), appointment.getBarberName(), appointment.getBookingTime());
        
        NotificationOutbox outbox = new NotificationOutbox(
                appointment.getCustomerEmail(),
                "EMAIL",
                message,
                LocalDateTime.now(),
                "SENT"
        );
        
        notificationOutboxRepository.save(outbox);
        
        // Mark as sent; this row's PESSIMISTIC_WRITE lock is released when the
        // transaction for this single appointment commits.
        appointment.setReminderSent(true);
        appointmentRepository.save(appointment);
    }
}
