package com.example.taskflow.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Service layer for notification outbox queries.
 * Previously the controller injected the repository directly — this
 * restores the layered architecture.
 */
@Service
public class NotificationService {

    private final NotificationOutboxRepository repository;

    public NotificationService(NotificationOutboxRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<NotificationOutboxResponse> getRecentNotifications() {
        return repository.findTop100ByOrderBySentAtDesc()
                .stream()
                .map(NotificationOutboxResponse::fromEntity)
                .toList();
    }
}
