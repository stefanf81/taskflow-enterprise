package com.example.taskflow.notification;

import java.time.Duration;

/**
 * Retry policy shared by the relay (stale-claim reclaim) and the sender (failed delivery).
 *
 * <p>The delay after the n-th failed attempt is {@code BASE * 2^(n-1)}, capped at {@link #MAX_DELAY}:
 * 30 s, 60 s, 2 min, 4 min, ... up to 1 h. {@link #MAX_ATTEMPTS} matches the V17
 * {@code chk_outbox_retry} constraint ({@code retry_count <= 10}); a row that reaches it stays
 * FAILED and is never claimed again.
 */
final class OutboxBackoff {

    static final int MAX_ATTEMPTS = 10;
    static final Duration BASE_DELAY = Duration.ofSeconds(30);
    static final Duration MAX_DELAY = Duration.ofHours(1);

    private OutboxBackoff() {
    }

    /** Delay before the next attempt after {@code failedAttempts} (>= 1) failures. */
    static Duration delayAfter(int failedAttempts) {
        int exponent = Math.max(0, Math.min(failedAttempts - 1, 20));
        Duration delay = BASE_DELAY.multipliedBy(1L << exponent);
        return delay.compareTo(MAX_DELAY) > 0 ? MAX_DELAY : delay;
    }
}
