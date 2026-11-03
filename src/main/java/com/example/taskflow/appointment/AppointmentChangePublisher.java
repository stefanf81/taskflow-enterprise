package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.core.LogSanitizer;
import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

/**
 * What follows a write to an appointment, shared by {@link AppointmentBookingService} and
 * {@link AppointmentLifecycleService}: the domain events (status change, cancellation), the
 * availability event (handled after commit, see {@link AvailabilityCacheEvictionListener}), the
 * admin dashboard stream event and the tags on the current tracing span.
 */
@Component
class AppointmentChangePublisher {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentChangePublisher.class);

    private final ApplicationEventPublisher eventPublisher;
    private final Tracer tracer;
    private final Clock clock;

    AppointmentChangePublisher(ApplicationEventPublisher eventPublisher, Tracer tracer, Clock clock) {
        this.eventPublisher = eventPublisher;
        this.tracer = tracer;
        this.clock = clock;
    }

    /**
     * Signals that availability changed for the appointment's barber and date. The event is
     * handled after the transaction commits so a rollback never clears committed cache state and
     * a cache failure never rolls back a committed booking.
     */
    void availabilityChanged(Appointment saved) {
        eventPublisher.publishEvent(AvailabilityChangedEvent.single(saved.getBarberName(), saved.getBookingDate()));
    }

    /**
     * The status-change event. The notification outbox entry is written by the (separate)
     * notification module's listener, so this module stays decoupled from it.
     */
    void statusChanged(Object source, Appointment saved) {
        eventPublisher.publishEvent(new AppointmentStatusChangedEvent(source, AppointmentDetails.of(saved)));
    }

    /** The "has been cancelled" event (outbox e-mail); carries the already-cancelled snapshot. */
    void cancelled(Appointment saved, AppointmentCancelledEvent.CancelledBy cancelledBy) {
        eventPublisher.publishEvent(new AppointmentCancelledEvent(AppointmentDetails.of(saved), cancelledBy));
    }

    /** Tells the open admin dashboards to refresh; nothing is published for an unsaved row. */
    void adminEvent(AppointmentAdminEvent.Type type, Long appointmentId) {
        if (appointmentId != null) {
            eventPublisher.publishEvent(new AppointmentAdminEvent(type, appointmentId, Instant.now(clock)));
        }
    }

    /**
     * Safely tags the current tracing span - swallowed on failure. Never pass customer data: traces
     * are exported to a separate backend with different access and retention.
     */
    void tagSpan(String... keyValuePairs) {
        try {
            Span span = tracer.currentSpan();
            if (span != null) {
                for (int i = 0; i < keyValuePairs.length - 1; i += 2) {
                    span.tag(keyValuePairs[i], keyValuePairs[i + 1]);
                }
            }
        } catch (Exception e) {
            logger.warn("Failed to add tracing tags: {}", LogSanitizer.stripNewlines(e.getMessage()));
        }
    }
}
