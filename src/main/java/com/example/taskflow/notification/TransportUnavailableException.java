package com.example.taskflow.notification;

import java.util.Map;

/**
 * The mail transport could not be used at all: the connection was refused or timed out, or the
 * server rejected the credentials, before any message of the batch was handed over. Nothing was
 * delivered and no message is at fault, so {@link NotificationSender} returns the claims without
 * counting an attempt and {@link NotificationRelayScheduler} pauses delivery. Counting these
 * failures used to exhaust every queued message's retry budget during a mail-server outage longer
 * than about three hours (BENCHMARKS.md §75).
 *
 * <p>Messages that failed before the transport was involved (they could not be built) are carried
 * in {@link #rejectedBeforeSending()}: those did fail, and still count.
 */
final class TransportUnavailableException extends RuntimeException {

    private final transient Map<Long, RuntimeException> rejectedBeforeSending;

    /** The cause is kept for diagnosis only: mail exceptions can contain recipients or credentials. */
    TransportUnavailableException(Throwable cause, Map<Long, RuntimeException> rejectedBeforeSending) {
        super("Mail transport unavailable", cause);
        this.rejectedBeforeSending = Map.copyOf(rejectedBeforeSending);
    }

    Map<Long, RuntimeException> rejectedBeforeSending() {
        return rejectedBeforeSending;
    }
}
