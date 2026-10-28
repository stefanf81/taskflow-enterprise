package com.example.taskflow.notification;

import org.jspecify.annotations.Nullable;

import java.time.LocalDateTime;
record NotificationOutboxResponse(
    Long id,
    String recipient,
    @Nullable String type,
    String message,
    @Nullable LocalDateTime sentAt,
    String status,
    int retryCount
) {
    public static NotificationOutboxResponse fromEntity(NotificationOutbox entity) {
        return new NotificationOutboxResponse(
            entity.getId(),
            entity.getRecipient(),
            entity.getType(),
            entity.getMessage(),
            entity.getSentAt(),
            entity.getStatus(),
            entity.getRetryCount()
        );
    }
}
