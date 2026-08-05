package com.example.taskflow.notification.internal;

import com.example.taskflow.notification.NotificationOutbox;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface NotificationOutboxRepository extends JpaRepository<NotificationOutbox, Long> {
    List<NotificationOutbox> findTop100ByOrderBySentAtDesc();
    List<NotificationOutbox> findAllByOrderBySentAtDesc();

    // Rows queued for (first) delivery.
    List<NotificationOutbox> findByStatus(String status);

    // Rows that previously failed but are still under the retry threshold.
    List<NotificationOutbox> findByStatusAndRetryCountLessThan(String status, int maxRetryCount);

    /**
     * Atomically claim claimable rows for delivery. Uses PESSIMISTIC_WRITE with
     * a SKIP LOCKED hint (jakarta.persistence.lock.timeout = -2 → PostgreSQL
     * {@code FOR UPDATE SKIP LOCKED}) so multiple relay instances never load the
     * same row. On H2 the hint degrades to a regular {@code FOR UPDATE}, which is
     * fine for the single-instance dev/test path.
     *
     * <p>The caller must, within the same transaction, immediately flip each
     * claimed row to {@code PROCESSING} + record {@code claimedAt}/{@code claimedBy}
     * and commit before dispatching, so the lock is released and the row is
     * visible as claimed to other instances.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints({@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2")})
    @Query("SELECT n FROM NotificationOutbox n " +
            "WHERE n.status = 'PENDING' OR (n.status = 'FAILED' AND n.retryCount < :max) " +
            "ORDER BY n.id")
    List<NotificationOutbox> findClaimableForUpdate(@Param("max") int maxRetry, Pageable pageable);

    /**
     * Stale-claim reclaim: rows claimed as PROCESSING whose {@code claimedAt} is
     * older than the threshold are presumed abandoned (the owning instance
     * crashed mid-batch) and reset to PENDING for re-delivery.
     */
    @Query("SELECT n FROM NotificationOutbox n " +
            "WHERE n.status = 'PROCESSING' AND n.claimedAt < :threshold " +
            "ORDER BY n.id")
    List<NotificationOutbox> findStaleProcessing(@Param("threshold") LocalDateTime threshold, Pageable pageable);
}
