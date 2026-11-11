package com.example.taskflow.notification;

import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import com.example.taskflow.testsupport.MutableTestClock;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Real DB transactions + real SMTP adapter; mock only the transport so no customer/network sends occur. */
@SpringBootTest(properties = {
        "app.schedulers.enabled=false", "app.rate-limit.enabled=false", "app.notification.gateway=smtp",
        "app.notification.smtp.host=smtp.invalid", "app.notification.smtp.from=bookings@example.com",
        "app.notification.simulate-failures=true", "app.instance.id=delivery-test"
})
@Import(NotificationDeliveryIntegrationTest.TestClockConfig.class)
class NotificationDeliveryIntegrationTest {

    private static final Instant NOW = Instant.parse("2031-03-10T10:00:00Z");

    @TestConfiguration
    static class TestClockConfig {
        @Bean @Primary MutableTestClock deliveryClock() { return new MutableTestClock(NOW); }
    }

    @Autowired private MutableTestClock clock;
    @Autowired private NotificationOutboxRepository outbox;
    @Autowired private NotificationRelayScheduler relay;
    @Autowired private NotificationSender sender;
    @Autowired private PlatformTransactionManager transactions;
    @MockitoBean private JavaMailSender mailSender;

    @BeforeEach
    void setUp() {
        clock.set(NOW);
        outbox.deleteAll();
        when(mailSender.createMimeMessage()).thenAnswer(invocation -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(), "message preparation must be outside DB tx");
            return new MimeMessage(Session.getInstance(new Properties()));
        });
    }

    @Test
    void smtpIsOutsideBothDatabaseTransactionsAndAnAccidentalCallerTransaction() {
        NotificationOutbox row = enqueue();
        NotificationSender.Claim claim = relay.claimBatch().getFirst();
        doAnswer(invocation -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(), "SMTP must not hold a DB transaction");
            assertEquals("PROCESSING", reload(row).getStatus(), "claim transaction committed before SMTP");
            return null;
        }).when(mailSender).send(any(MimeMessage.class));

        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            sender.process(claim);
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive(), "caller transaction resumes");
        });

        assertEquals("SENT", reload(row).getStatus());
        verify(mailSender).send(any(MimeMessage.class));
    }

    @Test
    void smtpFailureRecoversAfterBackoffAndSimulationHookDoesNotAffectRealGateway() {
        NotificationOutbox row = enqueue(); // fail* is legitimate; the SMTP gateway must ignore the demo hook.
        AtomicInteger calls = new AtomicInteger();
        doAnswer(invocation -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            if (calls.getAndIncrement() == 0) {
                throw new MailSendException("offline");
            }
            return null;
        }).when(mailSender).send(any(MimeMessage[].class)); // the relay sends its claims as one batch

        relay.relay();
        assertEquals("FAILED", reload(row).getStatus());
        assertEquals(1, reload(row).getRetryCount());
        assertEquals(LocalDateTime.ofInstant(NOW.plusSeconds(30), clock.getZone()), reload(row).getNextAttemptAt());
        relay.relay();
        assertEquals(1, calls.get(), "no retry during backoff");
        clock.advance(Duration.ofSeconds(31));
        relay.relay();

        assertEquals(2, calls.get());
        assertEquals("SENT", reload(row).getStatus());
        assertNull(reload(row).getClaimedAt());
    }

    @Test
    void releasingUnstartedClaimsDoesNotCountAttemptsOrReleaseNewerClaims() {
        NotificationOutbox row = enqueue();
        NotificationSender.Claim old = relay.claimBatch().getFirst();
        relay.releaseUnstartedClaims(java.util.List.of(old));
        assertEquals("PENDING", reload(row).getStatus());
        assertEquals(0, reload(row).getRetryCount());
        clock.advance(Duration.ofSeconds(1));
        NotificationSender.Claim current = relay.claimBatch().getFirst();

        relay.releaseUnstartedClaims(java.util.List.of(old));

        assertEquals("PROCESSING", reload(row).getStatus());
        assertEquals(current.claimedAt(), reload(row).getClaimedAt());
        verifyNoInteractions(mailSender);
    }

    private NotificationOutbox enqueue() {
        return outbox.save(new NotificationOutbox("fail.legitimate@example.com", "EMAIL",
                "Subject: Appointment APPROVED - Dear Test, appointment approved.",
                LocalDateTime.ofInstant(clock.instant(), clock.getZone()), "PENDING"));
    }

    private NotificationOutbox reload(NotificationOutbox row) {
        return outbox.findById(row.getId()).orElseThrow();
    }
}
