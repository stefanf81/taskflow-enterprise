package com.example.taskflow.auth;

import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.core.SchedulerProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * Loads the durable denylist ({@link PersistentTokenRevocations}) back into {@link TokenRevocationList}:
 * once when the application is ready, so a restarted replica denies what it revoked before, and every
 * minute, so Redis gets back revocations it lost (restart without persistence, a write that never
 * reached it) and replicas see each other's revocations within a minute while Redis is down. The
 * periodic run also deletes expired rows. Failures are logged and retried by the next run.
 */
@Component
class TokenRevocationRestorer {

    private static final Logger logger = LoggerFactory.getLogger(TokenRevocationRestorer.class);

    private final PersistentTokenRevocations persistent;
    private final TokenRevocationList revocations;
    private final boolean schedulersEnabled;

    TokenRevocationRestorer(PersistentTokenRevocations persistent, TokenRevocationList revocations,
                            SchedulerProperties schedulers) {
        this.persistent = persistent;
        this.revocations = revocations;
        this.schedulersEnabled = schedulers.enabled();
    }

    @EventListener(ApplicationReadyEvent.class)
    void restoreAtStartup() {
        restore();
    }

    /** A no-op when {@code app.schedulers.enabled=false} (the Gradle {@code test} task). */
    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    void scheduledRestore() {
        if (schedulersEnabled) {
            restore();
            purge();
        }
    }

    int restore() {
        try {
            return revocations.restore(persistent.active(Instant.now(TokenProvider.TOKEN_CLOCK)));
        } catch (RuntimeException e) {
            logger.warn("Stored token revocations could not be loaded: {}", LogSanitizer.safeMessage(e));
            return 0;
        }
    }

    int purge() {
        try {
            return persistent.deleteExpired(Instant.now(TokenProvider.TOKEN_CLOCK));
        } catch (RuntimeException e) {
            logger.warn("Expired token revocations could not be deleted: {}", LogSanitizer.safeMessage(e));
            return 0;
        }
    }
}
