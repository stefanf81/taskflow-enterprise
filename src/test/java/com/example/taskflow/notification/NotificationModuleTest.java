package com.example.taskflow.notification;

import com.example.taskflow.appointment.AppointmentCancelledEvent;
import com.example.taskflow.appointment.AppointmentCancelledEvent.CancelledBy;
import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentStatus;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.modulith.test.Scenario;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The notification module reacts to appointment events alone: it receives an
 * {@link AppointmentDetails} snapshot and writes the e-mail to its outbox.
 */
@ApplicationModuleTest(mode = ApplicationModuleTest.BootstrapMode.ALL_DEPENDENCIES)
@TestPropertySource(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class NotificationModuleTest {

    @Autowired
    private NotificationOutboxRepository outbox;

    @Test
    void aCancellationEventEnqueuesAPendingEmail(Scenario scenario) {
        AppointmentDetails booking = new AppointmentDetails(
                9_000_001L, "module-pub-1", "Module Test", "notify-module@example.com", "Alex the Barber",
                "Classic Haircut", LocalDate.now().plusDays(3), "10:00", AppointmentStatus.CANCELLED);

        scenario.publish(new AppointmentCancelledEvent(booking, CancelledBy.ADMIN))
                .andWaitForStateChange(() -> outbox.findTop100ByOrderBySentAtDesc().stream()
                        .filter(row -> "notify-module@example.com".equals(row.getRecipient()))
                        .filter(row -> "PENDING".equals(row.getStatus()))
                        .findFirst()
                        .orElse(null))
                .andVerify(row -> assertTrue(row.getMessage().contains("has been cancelled"), row.getMessage()));
    }
}
