package com.example.taskflow.notification;

import java.time.LocalDateTime;

public record NotificationOutboxResponse(
    Long id,
    String recipient,
    String type,
    String message,
    LocalDateTime sentAt,
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
