package com.example.todoapi.notification;

import com.example.todoapi.appointment.Appointment;
import com.example.todoapi.appointment.AppointmentStatusChangedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

@Component
public class NotificationListener {

    private static final Logger logger = LoggerFactory.getLogger(NotificationListener.class);

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
        
        if ("APPROVED".equalsIgnoreCase(appointment.getStatus())) {
            logger.info("Subject: Appointment APPROVED");
            logger.info("Dear {},", maskName(appointment.getCustomerName()));
            logger.info("Your appointment at BarberFlow has been approved by the owner.");
            logger.info("-------------------------------------------------------------------------");
            logger.info("Barber  : {}", appointment.getBarberName());
            logger.info("Service : {}", appointment.getServiceType());
            logger.info("Date    : {}", appointment.getBookingDate());
            logger.info("Time    : {}", appointment.getBookingTime());
            logger.info("-------------------------------------------------------------------------");
            logger.info("We look forward to seeing you. Thank you for choosing BarberFlow!");
        } else if ("DENIED".equalsIgnoreCase(appointment.getStatus())) {
            logger.info("Subject: Appointment DECLINED");
            logger.info("Dear {},", maskName(appointment.getCustomerName()));
            logger.info("Unfortunately, we could not accommodate your appointment request on {} at {}.", 
                    appointment.getBookingDate(), appointment.getBookingTime());
            logger.info("Please feel free to book another available slot on our website!");
        } else {
            logger.info("Subject: Appointment Update");
            logger.info("Dear {},", maskName(appointment.getCustomerName()));
            logger.info("Your appointment status has been updated to: {}.", appointment.getStatus());
        }
        logger.info("=========================================================================");
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