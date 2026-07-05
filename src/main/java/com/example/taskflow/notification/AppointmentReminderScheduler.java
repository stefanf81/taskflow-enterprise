package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
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

    // Runs every hour. For testing, we can keep it hourly. "0 0 * * * *"
    // But since it's a showcase, maybe every 15 minutes is fine.
    @Scheduled(fixedRate = 900000) // 15 minutes
    @Transactional
    public void processReminders() {
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        logger.info("Scanning for appointments needing 24-hour reminders for date: {}", tomorrow);

        List<Appointment> upcomingAppointments = appointmentRepository.findForReminderWithLock(tomorrow, false, "APPROVED");

        for (Appointment appointment : upcomingAppointments) {
            logger.info("Sending reminder to {} for appointment on {}", appointment.getCustomerEmail(), appointment.getBookingDate());
            
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
            
            // Mark as sent
            appointment.setReminderSent(true);
            appointmentRepository.save(appointment);
        }
        
        logger.info("Processed {} reminders.", upcomingAppointments.size());
    }
}
