package com.example.taskflow.core;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The background jobs, bound from {@code app.schedulers.*}.
 *
 * <ul>
 *   <li>{@code enabled} (default {@code true}): whether the {@code @Scheduled} jobs (reminders,
 *       outbox relay and retention, SSE heartbeat) do anything. The Gradle {@code test} task sets it
 *       to {@code false} so context tests do not race with live schedulers; tests call the job
 *       methods directly.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.schedulers")
public record SchedulerProperties(@DefaultValue("true") boolean enabled) {
}
