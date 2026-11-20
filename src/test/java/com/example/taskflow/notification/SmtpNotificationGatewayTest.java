package com.example.taskflow.notification;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;

import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SmtpNotificationGatewayTest {

    @Mock private JavaMailSender mailSender;
    private SmtpNotificationGateway gateway;
    private MimeMessage mime;

    @BeforeEach
    void setUp() {
        gateway = new SmtpNotificationGateway(mailSender, "bookings@example.com");
        mime = new MimeMessage(Session.getInstance(new Properties()));
        lenient().when(mailSender.createMimeMessage()).thenReturn(mime);
    }

    @Test
    void sendsTheExistingSubjectAndBodyAsUtf8PlainTextWithOneRecipient() throws Exception {
        gateway.send(message("Subject: Appointment APPROVED - Dear Zoë, your appointment is approved."));

        verify(mailSender).send(mime);
        mime.saveChanges();
        assertThat(mime.getFrom()[0].toString()).isEqualTo("bookings@example.com");
        assertThat(mime.getAllRecipients()).hasSize(1);
        assertThat(mime.getAllRecipients()[0].toString()).isEqualTo("customer@example.com");
        assertThat(mime.getSubject()).isEqualTo("Appointment APPROVED");
        assertThat(mime.getContent()).isEqualTo("Dear Zoë, your appointment is approved.");
        assertThat(mime.getContentType()).containsIgnoringCase("text/plain").containsIgnoringCase("UTF-8");
        assertThat(mime.getHeader("X-Taskflow-Notification-Id", null)).isEqualTo("42");
    }

    @Test
    void remindersWithoutEmbeddedSubjectUseDefaultAndRemainPlainText() throws Exception {
        gateway.send(message("Hi Zoë, reminder tomorrow. <script>not HTML</script>"));
        assertThat(mime.getSubject()).isEqualTo("Appointment notification");
        assertThat(mime.getContent()).isEqualTo("Hi Zoë, reminder tomorrow. <script>not HTML</script>");
    }

    @Test
    void rejectsHeaderInjectionAndUnsupportedChannelsWithoutSending() {
        assertThrows(IllegalArgumentException.class, () -> gateway.send(message("Subject: test\r\nBcc: other@example.com - body")));
        assertThrows(IllegalArgumentException.class, () -> gateway.send(
                new NotificationGateway.Message(42L, "customer@example.com\r\nBcc: other@example.com", "EMAIL", "body")));
        assertThrows(IllegalArgumentException.class, () -> gateway.send(
                new NotificationGateway.Message(42L, "customer@example.com", "SMS", "body")));
        verify(mailSender, never()).send(any(MimeMessage.class));
    }

    @Test
    void transportFailurePropagatesSoTheOutboxCanRetry() {
        doThrow(new MailSendException("offline")).when(mailSender).send(mime);
        assertThrows(MailSendException.class, () -> gateway.send(message("body")));
    }

    @Test
    void sendsABatchInOneSessionAndReportsOnlyTheMessagesTheServerRefused() {
        Session session = Session.getInstance(new Properties());
        when(mailSender.createMimeMessage()).thenAnswer(invocation -> new MimeMessage(session));
        doAnswer(invocation -> {
            MimeMessage[] sent = (MimeMessage[]) invocation.getRawArguments()[0];
            assertThat(sent).hasSize(2);
            // The transport refused the second one only.
            throw new MailSendException(java.util.Map.of(sent[1], new MailSendException("550 mailbox unavailable")));
        }).when(mailSender).send(any(MimeMessage[].class));

        var failed = gateway.sendAll(java.util.List.of(
                new NotificationGateway.Message(1L, "a@example.com", "EMAIL", "first"),
                new NotificationGateway.Message(2L, "b@example.com", "EMAIL", "second"),
                new NotificationGateway.Message(3L, "c@example.com\r\nBcc: x@example.com", "EMAIL", "injected")));

        verify(mailSender).send(any(MimeMessage[].class));
        verify(mailSender, never()).send(any(MimeMessage.class));
        assertThat(failed.keySet()).containsExactlyInAnyOrder(2L, 3L);
        assertThat(failed.get(3L)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectedCredentialsReportTheTransportUnavailableInsteadOfFailingEveryMessage() {
        when(mailSender.createMimeMessage()).thenAnswer(invocation -> new MimeMessage(Session.getInstance(new Properties())));
        doThrow(new org.springframework.mail.MailAuthenticationException("535 bad credentials"))
                .when(mailSender).send(any(MimeMessage[].class));

        var outage = assertThrows(TransportUnavailableException.class, () -> gateway.sendAll(java.util.List.of(
                message("one"), new NotificationGateway.Message(43L, "other@example.com", "EMAIL", "two"))));

        assertThat(outage.rejectedBeforeSending()).isEmpty();
    }

    /** JavaMailSenderImpl's connect failure: every message listed under the connection's own exception. */
    @Test
    void aServerThatCouldNotBeReachedReportsTheTransportUnavailable() {
        when(mailSender.createMimeMessage()).thenAnswer(invocation -> new MimeMessage(Session.getInstance(new Properties())));
        doAnswer(invocation -> {
            Exception refused = new jakarta.mail.MessagingException("Could not connect to SMTP host");
            java.util.Map<Object, Exception> failed = new java.util.LinkedHashMap<>();
            for (MimeMessage sent : (MimeMessage[]) invocation.getRawArguments()[0]) {
                failed.put(sent, refused);
            }
            throw new MailSendException("Mail server connection failed", refused, failed);
        }).when(mailSender).send(any(MimeMessage[].class));

        var outage = assertThrows(TransportUnavailableException.class, () -> gateway.sendAll(java.util.List.of(
                message("one"),
                new NotificationGateway.Message(43L, "other@example.com", "EMAIL", "two"),
                // Cannot be built: it never reaches the transport, so it still fails on its own.
                new NotificationGateway.Message(44L, "third@example.com", "EMAIL", "Subject: x\r\nBcc: y@example.com - z"))));

        assertThat(outage.rejectedBeforeSending().keySet()).containsExactly(44L);
    }

    /** The same, from Spring's real sender: a port where nothing listens refuses the connection. */
    @Test
    void aRealMailSenderThatCannotConnectReportsTheTransportUnavailable() throws Exception {
        int closedPort;
        try (java.net.ServerSocket socket = new java.net.ServerSocket(0)) {
            closedPort = socket.getLocalPort();
        }
        org.springframework.mail.javamail.JavaMailSenderImpl real = new org.springframework.mail.javamail.JavaMailSenderImpl();
        real.setHost("127.0.0.1");
        real.setPort(closedPort);
        real.getJavaMailProperties().put("mail.smtp.connectiontimeout", "2000");
        SmtpNotificationGateway realGateway = new SmtpNotificationGateway(real, "bookings@example.com");

        var outage = assertThrows(TransportUnavailableException.class, () -> realGateway.sendAll(java.util.List.of(
                message("one"), new NotificationGateway.Message(43L, "other@example.com", "EMAIL", "two"))));

        assertThat(outage.rejectedBeforeSending()).isEmpty();
        assertThat(outage.getCause()).isInstanceOf(MailSendException.class);
    }

    /** A reconnect that fails part-way: the messages before it were accepted, the rest still count. */
    @Test
    void aConnectionLostPartWayStillCountsTheMessagesItDidNotSend() {
        when(mailSender.createMimeMessage()).thenAnswer(invocation -> new MimeMessage(Session.getInstance(new Properties())));
        doAnswer(invocation -> {
            MimeMessage[] sent = (MimeMessage[]) invocation.getRawArguments()[0];
            Exception lost = new jakarta.mail.MessagingException("Could not connect to SMTP host");
            throw new MailSendException("Mail server connection failed", lost, java.util.Map.of(sent[1], lost));
        }).when(mailSender).send(any(MimeMessage[].class));

        var failed = gateway.sendAll(java.util.List.of(message("one"),
                new NotificationGateway.Message(43L, "other@example.com", "EMAIL", "two")));

        assertThat(failed.keySet()).containsExactly(43L);
    }

    /** Every message rejected with its own error (e.g. unknown recipients): the server was reached. */
    @Test
    void messagesRejectedOneByOneAreNotAnOutage() {
        when(mailSender.createMimeMessage()).thenAnswer(invocation -> new MimeMessage(Session.getInstance(new Properties())));
        doAnswer(invocation -> {
            java.util.Map<Object, Exception> failed = new java.util.LinkedHashMap<>();
            for (MimeMessage sent : (MimeMessage[]) invocation.getRawArguments()[0]) {
                failed.put(sent, new jakarta.mail.SendFailedException("550 unknown recipient"));
            }
            throw new MailSendException(failed);
        }).when(mailSender).send(any(MimeMessage[].class));

        var failed = gateway.sendAll(java.util.List.of(message("one"),
                new NotificationGateway.Message(43L, "other@example.com", "EMAIL", "two")));

        assertThat(failed.keySet()).containsExactlyInAnyOrder(42L, 43L);
    }

    @Test
    void unmappedFailedMessageKeyFailsClosedAcrossTheWholeBatch() {
        Session session = Session.getInstance(new Properties());
        when(mailSender.createMimeMessage()).thenAnswer(invocation -> new MimeMessage(session));
        doAnswer(invocation -> {
            // Simulate a wrapper returning a copied/foreign key in getFailedMessages().
            throw new MailSendException(java.util.Map.of("foreign-key", new MailSendException("rejected")));
        }).when(mailSender).send(any(MimeMessage[].class));

        var failed = gateway.sendAll(java.util.List.of(
                new NotificationGateway.Message(10L, "a@example.com", "EMAIL", "one"),
                new NotificationGateway.Message(11L, "b@example.com", "EMAIL", "two")));

        assertThat(failed.keySet()).containsExactlyInAnyOrder(10L, 11L);
    }

    private static NotificationGateway.Message message(String content) {
        return new NotificationGateway.Message(42L, "customer@example.com", "EMAIL", content);
    }
}
