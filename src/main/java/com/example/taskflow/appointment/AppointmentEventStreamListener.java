package com.example.taskflow.appointment;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** Publishes dashboard refresh signals only after the appointment transaction commits. */
@Component
public class AppointmentEventStreamListener {

    private final AppointmentEventStreamService eventStreamService;

    public AppointmentEventStreamListener(AppointmentEventStreamService eventStreamService) {
        this.eventStreamService = eventStreamService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleAppointmentAdminEvent(AppointmentAdminEvent event) {
        eventStreamService.publish(event);
    }
}
