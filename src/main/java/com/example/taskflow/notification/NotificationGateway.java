package com.example.taskflow.notification;

/** Delivery boundary: receives only an immutable snapshot, never a managed database entity. */
interface NotificationGateway {

    record Message(Long id, String recipient, String type, String content) { }

    /** Returns only after the transport accepted the message; failures must throw. */
    void send(Message message);
}
