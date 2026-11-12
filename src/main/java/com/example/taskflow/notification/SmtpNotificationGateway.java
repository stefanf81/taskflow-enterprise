package com.example.taskflow.notification;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.springframework.mail.MailPreparationException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
        mailSender.send(prepare(message));
    }

    /**
     * One SMTP session for the whole list: {@link JavaMailSender#send(MimeMessage...)} connects once
     * and reports the messages it could not send, so a batch pays one TCP/TLS handshake and one
     * authentication instead of one per message. A message that cannot be built (invalid address,
     * header injection) fails alone and is never handed to the transport.
     */
    @Override
    public Map<Long, RuntimeException> sendAll(List<Message> messages) {
        Map<Long, RuntimeException> failed = new LinkedHashMap<>();
        Map<MimeMessage, Long> prepared = new IdentityHashMap<>();
        List<MimeMessage> batch = new ArrayList<>(messages.size());
        for (Message message : messages) {
            try {
                MimeMessage mime = prepare(message);
                prepared.put(mime, message.id());
                batch.add(mime);
            } catch (RuntimeException e) {
                failed.put(message.id(), e);
            }
        }
        if (batch.isEmpty()) {
            return failed;
        }
        try {
            mailSender.send(batch.toArray(MimeMessage[]::new));
        } catch (MailSendException e) {
            // Keyed by the message object. A connection that failed part-way lists every message
            // from that point on; the ones before it were accepted.
            Map<Object, Exception> rejected = e.getFailedMessages();
            if (rejected.isEmpty()) {
                batch.forEach(mime -> failed.put(prepared.get(mime), e));
            } else {
                boolean unmappedKey = false;
                for (Map.Entry<Object, Exception> entry : rejected.entrySet()) {
                    Long id = prepared.get(entry.getKey());
                    if (id == null) {
                        unmappedKey = true;
                        break;
                    }
                    Exception cause = entry.getValue();
                    failed.put(id, cause instanceof RuntimeException runtime ? runtime : e);
                }
                if (unmappedKey || failed.isEmpty()) {
                    // Fail closed if a transport wrapper ever keys failedMessages differently, so
                    // undelivered messages are retried rather than silently marked SENT.
                    batch.forEach(mime -> failed.putIfAbsent(prepared.get(mime), e));
                }
            }
        } catch (RuntimeException e) {
            // Authentication or any other failure without a per-message account: nothing counts as
            // delivered. Should it happen on a reconnect after some messages went out, those are sent
            // again with the retry; the outbox delivers at least once.
            batch.forEach(mime -> failed.put(prepared.get(mime), e));
        }
        return failed;
    }

    private MimeMessage prepare(Message message) {
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
            return mime;
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
