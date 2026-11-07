package com.example.taskflow.notification;

import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Offline development/test gateway. Never logs customer contact details or message content. */
final class SimulatedNotificationGateway implements NotificationGateway {

    private static final Logger logger = LoggerFactory.getLogger(SimulatedNotificationGateway.class);
    private final boolean simulateFailures;

    SimulatedNotificationGateway(boolean simulateFailures) {
        this.simulateFailures = simulateFailures;
    }

    @Override
    public void send(Message message) {
        logger.info("Simulating notification delivery id={}", message.id());
        if (simulateFailures) {
            String recipient = message.recipient().trim().toLowerCase(Locale.ROOT);
            if (recipient.startsWith("fail") || recipient.startsWith("invalid")) {
                throw new IllegalStateException("Simulated notification delivery failure");
            }
        }
    }
}
