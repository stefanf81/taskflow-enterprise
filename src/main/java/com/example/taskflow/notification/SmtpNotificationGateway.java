package com.example.taskflow.notification;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import org.springframework.mail.MailPreparationException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

import java.nio.charset.StandardCharsets;

/** SMTP accepts EMAIL only. Existing outbox content is plain text, never interpreted as HTML. */
final class SmtpNotificationGateway implements NotificationGateway {

    private static final String DEFAULT_SUBJECT = "Appointment notification";
    private final JavaMailSender mailSender;
    private final String from;

    SmtpNotificationGateway(JavaMailSender mailSender, String from) {
        this.mailSender = mailSender;
        this.from = from;
    }

    @Override
    public void send(Message message) {
        if (!"EMAIL".equals(message.type())) {
            throw new IllegalArgumentException("SMTP gateway supports EMAIL only");
        }
        try {
            var mime = mailSender.createMimeMessage();
            var helper = new MimeMessageHelper(mime, false, StandardCharsets.UTF_8.name());
            helper.setFrom(address(from));
            helper.setTo(address(message.recipient()));
            String subject = DEFAULT_SUBJECT;
            String body = message.content();
            // The historical outbox format embeds a subject before " - "; reminders have no prefix.
            int separator = body.indexOf(" - ");
            if (body.startsWith("Subject: ") && separator > "Subject: ".length()) {
                subject = body.substring("Subject: ".length(), separator);
                body = body.substring(separator + 3);
            }
            if (subject.indexOf('\r') >= 0 || subject.indexOf('\n') >= 0) {
                throw new IllegalArgumentException("Invalid notification subject");
            }
            helper.setSubject(subject);
            helper.setText(body, false);
            mime.setHeader("X-Taskflow-Notification-Id", message.id().toString());
            mailSender.send(mime);
        } catch (MessagingException e) {
            throw new MailPreparationException("Invalid notification email", e);
        }
    }

    private static InternetAddress address(String value) throws MessagingException {
        if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Invalid notification address");
        }
        InternetAddress address = new InternetAddress(value, true);
        address.validate();
        return address;
    }
}
