package com.example.taskflow.notification;

import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * This replica, bound from {@code app.instance.*}.
 *
 * <ul>
 *   <li>{@code id} (no default): recorded as {@code claimed_by} on the outbox rows this replica
 *       claims. Unset or blank means a random {@code relay-<uuid>} per start
 *       ({@link NotificationRelayScheduler}).</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.instance")
record InstanceProperties(@Nullable String id) {
}
