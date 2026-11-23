package com.example.taskflow.notification;

import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service layer for notification outbox queries.
 * Previously the controller injected the repository directly — this
 * restores the layered architecture.
 */
@Service
class NotificationService {

    private final NotificationOutboxRepository repository;

    public NotificationService(NotificationOutboxRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<NotificationOutboxResponse> getRecentNotifications() {
        return repository.findTop100ByOrderBySentAtDescIdDesc().stream()
                .map(NotificationOutboxResponse::fromEntity)
                .toList();
    }
}
