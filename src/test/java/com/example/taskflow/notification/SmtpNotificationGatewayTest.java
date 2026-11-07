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

    private static NotificationGateway.Message message(String content) {
        return new NotificationGateway.Message(42L, "customer@example.com", "EMAIL", content);
    }
}
