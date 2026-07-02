package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import java.time.LocalDateTime;

@Component
public class NotificationListener {

    private static final Logger logger = LoggerFactory.getLogger(NotificationListener.class);
    private final NotificationOutboxRepository outboxRepository;

    public NotificationListener(NotificationOutboxRepository outboxRepository) {
        this.outboxRepository = outboxRepository;
    }

    @Async
    @EventListener
    public void handleAppointmentStatusChanged(AppointmentStatusChangedEvent event) {
        sendEmailNotification(event.getAppointment());
    }

    private void sendEmailNotification(Appointment appointment) {
        logger.info("=========================================================================");
        logger.info("EMAIL DISPATCHER (SIMULATED SMTP GATEWAY - ASYNC)");
        logger.info("=========================================================================");
        logger.info("To: {}", maskEmail(appointment.getCustomerEmail()));
        
        String subject;
        String content;

        if ("APPROVED".equalsIgnoreCase(appointment.getStatus())) {
            subject = "Appointment APPROVED";
            content = String.format("Dear %s, your %s appointment with %s on %s at %s has been APPROVED.",
                    appointment.getCustomerName(), appointment.getServiceType(), appointment.getBarberName(),
                    appointment.getBookingDate(), appointment.getBookingTime());
            
            logger.info("Subject: {}", subject);
            logger.info("Dear {},", maskName(appointment.getCustomerName()));
            logger.info("Your appointment at TaskFlow has been approved by the owner.");
            logger.info("-------------------------------------------------------------------------");
            logger.info("Barber  : {}", appointment.getBarberName());
            logger.info("Service : {}", appointment.getServiceType());
            logger.info("Date    : {}", appointment.getBookingDate());
            logger.info("Time    : {}", appointment.getBookingTime());
            logger.info("-------------------------------------------------------------------------");
            logger.info("We look forward to seeing you. Thank you for choosing TaskFlow!");
        } else if ("DENIED".equalsIgnoreCase(appointment.getStatus())) {
            subject = "Appointment DECLINED";
            content = String.format("Dear %s, unfortunately we could not accommodate your %s appointment with %s on %s at %s. Please try booking another slot.",
                    appointment.getCustomerName(), appointment.getServiceType(), appointment.getBarberName(),
                    appointment.getBookingDate(), appointment.getBookingTime());

            logger.info("Subject: {}", subject);
            logger.info("Dear {},", maskName(appointment.getCustomerName()));
            logger.info("Unfortunately, we could not accommodate your appointment request on {} at {}.", 
                    appointment.getBookingDate(), appointment.getBookingTime());
            logger.info("Please feel free to book another available slot on our website!");
        } else {
            subject = "Appointment Update";
            content = String.format("Dear %s, your appointment status has been updated to: %s.",
                    appointment.getCustomerName(), appointment.getStatus());

            logger.info("Subject: {}", subject);
            logger.info("Dear {},", maskName(appointment.getCustomerName()));
            logger.info("Your appointment status has been updated to: {}.", appointment.getStatus());
        }
        logger.info("=========================================================================");

        // Store standard outbox entry for admin auditing
        try {
            NotificationOutbox outbox = new NotificationOutbox(
                    appointment.getCustomerEmail(),
                    "EMAIL",
                    "Subject: " + subject + " - " + content,
                    LocalDateTime.now(),
                    "SENT"
            );
            outboxRepository.save(outbox);
        } catch (Exception e) {
            logger.error("Failed to save state change notification to outbox: {}", e.getMessage());
        }
    }

    private String maskEmail(String email) {
        if (email == null || email.isEmpty()) {
            return "***";
        }
        int atIndex = email.lastIndexOf('@');
        if (atIndex <= 0) {
            return "***";
        }
        String localPart = email.substring(0, atIndex);
        String domain = email.substring(atIndex);
        
        if (localPart.length() <= 2) {
            return "**" + domain;
        }
        
        return localPart.charAt(0) + "*" + localPart.charAt(localPart.length() - 1) + domain;
    }

    private String maskName(String name) {
        if (name == null || name.isEmpty()) {
            return "***";
        }
        if (name.length() <= 2) {
            return "**";
        }
        return name.charAt(0) + "***" + name.charAt(name.length() - 1);
    }
}