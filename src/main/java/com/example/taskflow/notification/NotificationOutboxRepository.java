package com.example.taskflow.notification;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface NotificationOutboxRepository extends JpaRepository<NotificationOutbox, Long> {
    List<NotificationOutbox> findAllByOrderBySentAtDesc();

    // Rows queued for (first) delivery.
    List<NotificationOutbox> findByStatus(String status);

    // Rows that previously failed but are still under the retry threshold.
    List<NotificationOutbox> findByStatusAndRetryCountLessThan(String status, int maxRetryCount);
}
