package com.example.taskflow.core;

import java.time.LocalDateTime;

/**
 * An entity whose audit timestamps ({@code created_at}, optionally {@code updated_at}) are set by
 * {@link EntityTimestampListener} from the injected {@code Clock}. Register the listener with
 * {@code @EntityListeners(EntityTimestampListener.class)}.
 */
public interface Timestamped {

    /** Before the first {@code INSERT}. */
    void markCreated(LocalDateTime now);

    /** Before every {@code UPDATE}; an entity without an update timestamp ignores it. */
    default void markUpdated(LocalDateTime now) {
    }
}
