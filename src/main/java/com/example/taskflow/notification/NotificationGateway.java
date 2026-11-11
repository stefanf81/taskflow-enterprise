package com.example.taskflow.notification;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Delivery boundary: receives only immutable snapshots, never a managed database entity. */
interface NotificationGateway {

    record Message(Long id, String recipient, String type, String content) { }

    /** Returns only after the transport accepted the message; failures must throw. */
    void send(Message message);

    /**
     * Sends several messages and returns the ones the transport did not accept, by message id, with
     * the failure. Every message not in the result was accepted. Never throws for a single message;
     * a gateway that can share one connection between the messages overrides this (SMTP), the default
     * sends them one by one.
     */
    default Map<Long, RuntimeException> sendAll(List<Message> messages) {
        Map<Long, RuntimeException> failed = new LinkedHashMap<>();
        for (Message message : messages) {
            try {
                send(message);
            } catch (RuntimeException e) {
                failed.put(message.id(), e);
            }
        }
        return failed;
    }
}
