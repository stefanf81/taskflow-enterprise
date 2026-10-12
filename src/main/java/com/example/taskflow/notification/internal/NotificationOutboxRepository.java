package com.example.taskflow.notification.internal;

import com.example.taskflow.notification.NotificationOutbox;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface NotificationOutboxRepository extends JpaRepository<NotificationOutbox, Long> {
    List<NotificationOutbox> findTop100ByOrderBySentAtDesc();

    /**
     * Atomically claim claimable rows for delivery. Uses PESSIMISTIC_WRITE with
     * a SKIP LOCKED hint (jakarta.persistence.lock.timeout = -2 → PostgreSQL
     * {@code FOR UPDATE SKIP LOCKED}) so multiple relay instances never load the
     * same row. On H2 the hint degrades to a regular {@code FOR UPDATE}, which is
     * fine for the single-instance dev/test path.
     *
     * <p>Rows in backoff ({@code nextAttemptAt} in the future) are not claimable; a
     * {@code null} {@code nextAttemptAt} means "immediately".
     *
     * <p>The caller must, within the same transaction, immediately flip each
     * claimed row to {@code PROCESSING} + record {@code claimedAt}/{@code claimedBy}
     * and commit before dispatching, so the lock is released and the row is
     * visible as claimed to other instances.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints({@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2")})
    @Query("SELECT n FROM NotificationOutbox n " +
            "WHERE (n.status = 'PENDING' OR (n.status = 'FAILED' AND n.retryCount < :max)) " +
            "AND (n.nextAttemptAt IS NULL OR n.nextAttemptAt <= :now) " +
            "ORDER BY n.id")
    List<NotificationOutbox> findClaimableForUpdate(@Param("max") int maxRetry,
                                                    @Param("now") LocalDateTime now,
                                                    Pageable pageable);

    /**
     * Stale-claim reclaim: rows claimed as PROCESSING whose {@code claimedAt} is
     * older than the threshold are presumed abandoned (the owning instance
     * crashed or hung mid-send). Locked {@code FOR UPDATE SKIP LOCKED} like the
     * claim query so two instances never reclaim (and count) the same row twice,
     * and a sender finishing at the same moment either wins the row lock first
     * (the row is then no longer PROCESSING) or finds its claim gone.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints({@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2")})
    @Query("SELECT n FROM NotificationOutbox n " +
            "WHERE n.status = 'PROCESSING' AND n.claimedAt < :threshold " +
            "ORDER BY n.id")
    List<NotificationOutbox> findStaleProcessing(@Param("threshold") LocalDateTime threshold, Pageable pageable);

    /**
     * Records a successful delivery, but only while the row is still PROCESSING and owned by the
     * claim identified by ({@code claimedBy}, {@code claimedAt}). Returns the number of rows
     * touched: 0 means the claim was lost (reclaimed, re-claimed by another worker, or deleted) and
     * the caller must not overwrite whatever happened since.
     */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE NotificationOutbox n SET n.status = 'SENT', n.claimedAt = NULL, n.claimedBy = NULL, " +
            "n.nextAttemptAt = NULL " +
            "WHERE n.id = :id AND n.status = 'PROCESSING' AND n.claimedBy = :claimedBy AND n.claimedAt = :claimedAt")
    int markSentIfClaimed(@Param("id") Long id,
                          @Param("claimedBy") String claimedBy,
                          @Param("claimedAt") LocalDateTime claimedAt);

    /**
     * Records a failed delivery (status FAILED, retry counter and backoff written by the caller),
     * with the same claim-ownership condition as {@link #markSentIfClaimed}.
     */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE NotificationOutbox n SET n.status = 'FAILED', n.retryCount = :retryCount, " +
            "n.nextAttemptAt = :nextAttemptAt, n.claimedAt = NULL, n.claimedBy = NULL " +
            "WHERE n.id = :id AND n.status = 'PROCESSING' AND n.claimedBy = :claimedBy AND n.claimedAt = :claimedAt")
    int markFailedIfClaimed(@Param("id") Long id,
                            @Param("claimedBy") String claimedBy,
                            @Param("claimedAt") LocalDateTime claimedAt,
                            @Param("retryCount") int retryCount,
                            @Param("nextAttemptAt") LocalDateTime nextAttemptAt);

    /** Retention: deletes delivered rows enqueued before the cutoff. Returns the number deleted. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM NotificationOutbox n WHERE n.status = 'SENT' AND n.sentAt < :cutoff")
    int deleteSentBefore(@Param("cutoff") LocalDateTime cutoff);
}
