package com.example.taskflow.notification;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The notification outbox, bound from {@code app.notification.*}.
 *
 * <ul>
 *   <li>{@code retention-days} (default 30): SENT rows older than this are deleted.</li>
 *   <li>{@code retention-cron} (default {@value #DEFAULT_RETENTION_CRON}): when that purge runs. Read
 *       by the {@code @Scheduled} placeholder of {@link NotificationRetentionScheduler}, which uses
 *       the same default.</li>
 *   <li>{@code simulate-failures} (default {@code false}): test/demo switch that treats recipients
 *       starting with "fail" or "invalid" as undeliverable. Must stay off in production.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.notification")
record NotificationProperties(
        @DefaultValue("30") int retentionDays,
        @DefaultValue(NotificationProperties.DEFAULT_RETENTION_CRON) String retentionCron,
        @DefaultValue("false") boolean simulateFailures) {

    static final String DEFAULT_RETENTION_CRON = "0 30 3 * * *";
}
