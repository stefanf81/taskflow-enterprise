package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentService;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Component
class AppointmentReminderScheduler {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentReminderScheduler.class);

    private final AppointmentService appointmentService;
    private final NotificationOutboxRepository notificationOutboxRepository;
    private final ObjectProvider<AppointmentReminderScheduler> selfProvider;
    private final Clock clock;
    private final boolean schedulersEnabled;

    @Autowired
    public AppointmentReminderScheduler(AppointmentService appointmentService,
                                        NotificationOutboxRepository notificationOutboxRepository,
                                        ObjectProvider<AppointmentReminderScheduler> selfProvider,
                                        Clock clock,
                                        @Value("${app.schedulers.enabled:true}") boolean schedulersEnabled) {
        this.appointmentService = appointmentService;
        this.notificationOutboxRepository = notificationOutboxRepository;
        this.selfProvider = selfProvider;
        this.clock = clock;
        this.schedulersEnabled = schedulersEnabled;
    }

    /** Scheduler entry point; a no-op when {@code app.schedulers.enabled=false} (default for the test task). */
    @Scheduled(fixedRate = 900000) // 15 minutes
    public void scheduledReminders() {
        if (!schedulersEnabled) {
            return;
        }
        processReminders();
    }

    // Runs every 15 minutes. The outer sweep is NOT transactional: it only loads
    // the IDs that need a reminder, then processes each appointment in its own
    // transaction (see processOne). A5: previously the entire loop ran under a
    // single PESSIMISTIC_WRITE transaction, locking every matching row for the
    // whole sweep. Now the row lock is acquired and released per appointment.
    public void processReminders() {
        // "Tomorrow" is the shop's tomorrow, not the container's (usually UTC).
        LocalDate tomorrow = LocalDate.now(clock).plusDays(1);
        logger.info("Scanning for appointments needing 24-hour reminders for date: {}", tomorrow);

        // Resolve IDs through the appointment module's public API instead of
        // reaching into its internal AppointmentRepository (Spring Modulith
        // module boundary).
        List<Long> upcomingAppointmentIds = appointmentService.findAppointmentIdsNeedingReminders(tomorrow);

        int processed = 0;
        AppointmentReminderScheduler self = selfProvider.getIfAvailable();
        for (Long appointmentId : upcomingAppointmentIds) {
            try {
                // Call through the proxy provider so @Transactional on processOne is honored
                if (self != null) {
                    self.processOne(appointmentId);
                } else {
                    processOne(appointmentId);
                }
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
        // A5: the appointment module re-loads the single row with a PESSIMISTIC_WRITE lock inside
        // this dedicated transaction, so the lock is held only for this appointment and released
        // on commit, not for the whole sweep. It re-checks status, date and reminderSent under
        // the lock and marks the reminder as sent in the same transaction as the outbox row below.
        LocalDate tomorrow = LocalDate.now(clock).plusDays(1);
        AppointmentDetails appointment = appointmentService.claimReminder(appointmentId, tomorrow).orElse(null);
        if (appointment == null) {
            return;
        }

        logger.info("Queueing reminder for appointment id={} on {}", appointment.id(), appointment.bookingDate());

        String message = String.format("Hi %s, this is a reminder for your %s appointment with %s tomorrow at %s.",
                appointment.customerName(), appointment.serviceType(), appointment.barberName(), appointment.bookingTime());

        // Enqueue as PENDING: the relay claims PENDING/FAILED rows only, so this is what actually
        // gets the e-mail sent. (It used to be inserted as already-SENT and was never dispatched.)
        NotificationOutbox outbox = new NotificationOutbox(
                appointment.customerEmail(),
                "EMAIL",
                message,
                LocalDateTime.now(clock),
                "PENDING"
        );

        notificationOutboxRepository.save(outbox);
    }
}
