package com.example.taskflow.appointment.stream;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The admin dashboard event stream, bound from {@code app.sse.*}.
 *
 * <ul>
 *   <li>{@code max-connections-per-admin} (default 2, at least 1): open streams per admin; at the
 *       limit the oldest one is evicted.</li>
 *   <li>{@code heartbeat-interval-ms} (default {@value #DEFAULT_HEARTBEAT_INTERVAL_MS}): keeps idle
 *       proxy connections open and closes streams whose token expired. Read by the
 *       {@code @Scheduled} placeholder of {@link AppointmentEventStreamService}, which uses the same
 *       default.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.sse")
record SseProperties(
        @DefaultValue("2") int maxConnectionsPerAdmin,
        @DefaultValue(SseProperties.DEFAULT_HEARTBEAT_INTERVAL_MS) long heartbeatIntervalMs) {

    static final String DEFAULT_HEARTBEAT_INTERVAL_MS = "20000";
}
