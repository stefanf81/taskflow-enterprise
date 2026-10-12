package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import com.example.taskflow.testsupport.MutableTestClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Database-backed tests of the outbox pipeline (H2): reminders reach the relay (DATA-1), claim
 * ownership, retry cap, backoff and locking (DATA-3) and retention (DATA-12). The shop clock is a
 * {@link MutableTestClock} so time can be moved instead of slept; the live {@code @Scheduled} jobs
 * are switched off and the job methods are called directly.
 */
@SpringBootTest(properties = {
        "app.rate-limit.enabled=false",
        "app.schedulers.enabled=false",
        "app.notification.simulate-failures=true",
        "app.instance.id=relay-A"
})
@Import(NotificationOutboxIntegrationTest.TestClockConfig.class)
class NotificationOutboxIntegrationTest {

    private static final Instant NOW = Instant.parse("2031-03-10T10:00:00Z");

    @TestConfiguration
    static class TestClockConfig {
        @Bean
        @Primary
        MutableTestClock testClock() {
            return new MutableTestClock(NOW);
        }
    }

    @Autowired private MutableTestClock clock;
    @Autowired private NotificationOutboxRepository outbox;
    @Autowired private AppointmentRepository appointments;
    @Autowired private AppointmentReminderScheduler reminders;
    @Autowired private NotificationRelayScheduler relay;
    @Autowired private NotificationSender sender;
    @Autowired private NotificationRetentionScheduler retention;
    @Autowired private org.springframework.jdbc.core.JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        clock.set(NOW);
        outbox.deleteAll();
        // reviews.appointment_id is ON DELETE RESTRICT (V27): clear the seeded reviews first
        jdbc.update("DELETE FROM reviews");
        appointments.deleteAll();
    }

    private LocalDateTime now() {
        return LocalDateTime.ofInstant(clock.instant(), clock.getZone());
    }

    private NotificationOutbox enqueue(String recipient, String status) {
        return outbox.save(new NotificationOutbox(recipient, "EMAIL", "msg for " + recipient, now(), status));
    }

    private NotificationOutbox reload(NotificationOutbox row) {
        return outbox.findById(row.getId()).orElseThrow();
    }

    // ------------------------------------------------------------------ DATA-1

    @Test
    void reminderRowIsPickedUpByTheRelayClaimQueryAndEndsSent() {
        Appointment appointment = new Appointment("Rem Inder", "rem.inder@x.test", "555-1", "Alex the Barber",
                LocalDate.of(2031, 3, 11), "10:00", "Classic Haircut");
        appointment.setStatus("APPROVED");
        appointment = appointments.save(appointment);

        reminders.processReminders();

        List<NotificationOutbox> queued = outbox.findAll();
        assertEquals(1, queued.size());
        NotificationOutbox reminder = queued.get(0);
        assertEquals("PENDING", reminder.getStatus(), "enqueued as PENDING so that the relay will claim it");
        assertEquals("rem.inder@x.test", reminder.getRecipient());
        assertTrue(reminder.getMessage().contains("tomorrow at 10:00"));
        assertTrue(appointments.findById(appointment.getId()).orElseThrow().getReminderSent());

        // the relay's own claim path (claim query -> PROCESSING -> send -> SENT)
        relay.relay();

        NotificationOutbox delivered = reload(reminder);
        assertEquals("SENT", delivered.getStatus());
        assertNull(delivered.getClaimedBy());
        assertNull(delivered.getClaimedAt());
        assertEquals(0, delivered.getRetryCount());

        // and no second reminder on the next sweep
        reminders.processReminders();
        assertEquals(1, outbox.count());
    }

    @Test
    void appointmentsThatAreNotApprovedForTomorrowGetNoReminder() {
        for (String status : new String[] {"PENDING", "DENIED"}) {
            Appointment a = new Appointment("N " + status, "n." + status.toLowerCase() + "@x.test", "555-2",
                    "Alex the Barber", LocalDate.of(2031, 3, 11), "11:00", "Classic Haircut");
            a.setStatus(status);
            appointments.save(a);
        }
        Appointment later = new Appointment("Later", "later@x.test", "555-3", "Alex the Barber",
                LocalDate.of(2031, 3, 12), "12:00", "Classic Haircut");
        later.setStatus("APPROVED");
        appointments.save(later);

        reminders.processReminders();

        assertEquals(0, outbox.count());
    }

    // ------------------------------------------------------------------ DATA-3

    @Test
    void aStaleSenderCannotOverwriteAReclaimedAndReclaimedRow() {
        NotificationOutbox row = enqueue("race@x.test", "PENDING");

        // worker 1 claims, then hangs
        NotificationSender.Claim stale = relay.claimBatch().get(0);
        assertEquals(row.getId(), stale.id());
        assertEquals("PROCESSING", reload(row).getStatus());

        // the claim goes stale and is reclaimed; the backoff then elapses and worker 2 claims again
        clock.advance(Duration.ofMinutes(6));
        relay.reclaimStaleClaims();
        NotificationOutbox reclaimed = reload(row);
        assertEquals("PENDING", reclaimed.getStatus());
        assertEquals(1, reclaimed.getRetryCount(), "the abandoned attempt is counted");
        assertEquals(now().plusSeconds(30), reclaimed.getNextAttemptAt(), "30s backoff after the first failure");
        assertTrue(relay.claimBatch().isEmpty(), "not claimable while in backoff");
        clock.advance(Duration.ofSeconds(31));
        NotificationSender.Claim current = relay.claimBatch().get(0);
        assertEquals(row.getId(), current.id());
        assertTrue(current.claimedAt().isAfter(stale.claimedAt()));

        // worker 1 wakes up: it must neither send nor write anything
        sender.process(stale);
        assertEquals(0, outbox.markSentIfClaimed(row.getId(), stale.claimedBy(), stale.claimedAt()));
        assertEquals(0, outbox.markFailedIfClaimed(row.getId(), stale.claimedBy(), stale.claimedAt(), 5, now()));
        NotificationOutbox afterStale = reload(row);
        assertEquals("PROCESSING", afterStale.getStatus());
        assertEquals(current.claimedAt(), afterStale.getClaimedAt());
        assertEquals(1, afterStale.getRetryCount());

        // worker 2 finishes
        sender.process(current);
        assertEquals("SENT", reload(row).getStatus());

        // a very late worker 1 still cannot flip a SENT row back or to FAILED
        sender.process(stale);
        assertEquals(0, outbox.markFailedIfClaimed(row.getId(), stale.claimedBy(), stale.claimedAt(), 5, now()));
        assertEquals("SENT", reload(row).getStatus());
    }

    @Test
    void aSenderThatNeverReturnsCannotRetryForever() {
        NotificationOutbox row = enqueue("hang@x.test", "PENDING");

        for (int attempt = 1; attempt <= 10; attempt++) {
            clock.advance(Duration.ofHours(2)); // longer than any backoff
            assertEquals(1, relay.claimBatch().size(), "attempt " + attempt + " is claimable");
            clock.advance(Duration.ofMinutes(6)); // the sender hangs: the claim goes stale
            relay.reclaimStaleClaims();
            assertEquals(attempt, reload(row).getRetryCount());
        }

        NotificationOutbox dead = reload(row);
        assertEquals("FAILED", dead.getStatus());
        assertEquals(10, dead.getRetryCount());
        clock.advance(Duration.ofDays(2));
        assertTrue(relay.claimBatch().isEmpty(), "retry budget exhausted: never claimed again");
    }

    @Test
    void failedDeliveryBacksOffExponentiallyAndTheClaimQueryHonoursIt() {
        enqueue("fail.me@x.test", "PENDING"); // simulate-failures=true makes "fail*" undeliverable

        relay.relay();
        NotificationOutbox row = outbox.findAll().get(0);
        assertEquals("FAILED", row.getStatus());
        assertEquals(1, row.getRetryCount());
        assertEquals(now().plusSeconds(30), row.getNextAttemptAt());

        clock.advance(Duration.ofSeconds(29));
        relay.relay();
        assertEquals(1, reload(row).getRetryCount(), "still in backoff: not retried");

        clock.advance(Duration.ofSeconds(2)); // t+31s
        relay.relay();
        row = reload(row);
        assertEquals(2, row.getRetryCount());
        assertEquals(now().plusSeconds(60), row.getNextAttemptAt(), "second failure waits twice as long");

        clock.advance(Duration.ofSeconds(61));
        relay.relay();
        row = reload(row);
        assertEquals(3, row.getRetryCount());
        assertEquals(now().plusSeconds(120), row.getNextAttemptAt());
    }

    @Test
    void rowsWithoutNextAttemptAreImmediatelyClaimable() {
        NotificationOutbox row = enqueue("now@x.test", "PENDING");
        assertNull(row.getNextAttemptAt());

        List<NotificationSender.Claim> claims = relay.claimBatch();

        assertEquals(1, claims.size());
        assertEquals("relay-A", claims.get(0).claimedBy());
        assertEquals(row.getId(), claims.get(0).id());
    }

    @Test
    void healthyRowsAreDeliveredOnceAndNotClaimedAgain() {
        NotificationOutbox row = enqueue("ok@x.test", "PENDING");

        relay.relay();
        assertEquals("SENT", reload(row).getStatus());
        assertTrue(relay.claimBatch().isEmpty());
    }

    // ------------------------------------------------------------------ DATA-12 retention

    @Test
    void retentionDeletesOnlyDeliveredRowsOlderThanThirtyDays() {
        LocalDateTime base = now();
        NotificationOutbox oldSent = enqueueAt("old.sent@x.test", "SENT", base.minusDays(31));
        NotificationOutbox recentSent = enqueueAt("recent.sent@x.test", "SENT", base.minusDays(29));
        NotificationOutbox oldFailed = enqueueAt("old.failed@x.test", "FAILED", base.minusDays(90));
        NotificationOutbox oldPending = enqueueAt("old.pending@x.test", "PENDING", base.minusDays(90));

        int deleted = retention.purgeOldSent();

        assertEquals(1, deleted);
        assertTrue(outbox.findById(oldSent.getId()).isEmpty());
        assertTrue(outbox.findById(recentSent.getId()).isPresent());
        assertTrue(outbox.findById(oldFailed.getId()).isPresent(), "undelivered mail is never purged");
        assertTrue(outbox.findById(oldPending.getId()).isPresent());
    }

    private NotificationOutbox enqueueAt(String recipient, String status, LocalDateTime sentAt) {
        return outbox.save(new NotificationOutbox(recipient, "EMAIL", "m", sentAt, status));
    }
}
