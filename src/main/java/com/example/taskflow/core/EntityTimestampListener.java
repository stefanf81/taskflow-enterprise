package com.example.taskflow.core;

import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * JPA entity listener that stamps {@link Timestamped} entities from the injected {@link Clock}
 * instead of the wall clock, so a test's fixed or movable clock also decides the audit timestamps.
 *
 * <p>Hibernate creates entity listeners through Spring's bean container ({@code SpringBeanContainer},
 * registered by {@code HibernateJpaVendorAdapter}), which constructor-injects the {@code Clock}.
 *
 * <p>The timestamps stay in the JVM's zone, as the former {@code LocalDateTime.now()} wrote them:
 * these are audit columns, not booking times, and switching them to the shop zone would change the
 * meaning of the rows already stored. Only the time source is injected.
 */
public class EntityTimestampListener {

    private final Clock clock;

    public EntityTimestampListener(Clock clock) {
        this.clock = clock;
    }

    @PrePersist
    public void prePersist(Object entity) {
        if (entity instanceof Timestamped timestamped) {
            timestamped.markCreated(now());
        }
    }

    @PreUpdate
    public void preUpdate(Object entity) {
        if (entity instanceof Timestamped timestamped) {
            timestamped.markUpdated(now());
        }
    }

    private LocalDateTime now() {
        return LocalDateTime.ofInstant(clock.instant(), ZoneId.systemDefault());
    }
}
