package com.example.taskflow.auth;

import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.core.SchedulerProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps {@code refresh_sessions} and {@code refresh_credentials} bounded: every hour, deletes the
 * families that expired or were revoked (logout, reuse, password change). Idempotent, so every
 * replica may run it. Failures are logged and retried by the next run.
 */
@Component
class RefreshSessionPurger {

    private static final Logger logger = LoggerFactory.getLogger(RefreshSessionPurger.class);

    private final RefreshSessionService sessions;
    private final boolean schedulersEnabled;

    RefreshSessionPurger(RefreshSessionService sessions, SchedulerProperties schedulers) {
        this.sessions = sessions;
        this.schedulersEnabled = schedulers.enabled();
    }

    /** A no-op when {@code app.schedulers.enabled=false} (the Gradle {@code test} task). */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 600_000)
    void scheduledPurge() {
        if (schedulersEnabled) {
            purge();
        }
    }

    int purge() {
        try {
            int deleted = sessions.purgeInactive();
            if (deleted > 0) {
                logger.info("Removed {} expired or revoked refresh session(s)", deleted);
            }
            return deleted;
        } catch (RuntimeException e) {
            logger.warn("Expired refresh sessions could not be deleted: {}", LogSanitizer.safeMessage(e));
            return 0;
        }
    }
}
