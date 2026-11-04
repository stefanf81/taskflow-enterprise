package com.example.taskflow.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Access to {@code /actuator/prometheus}, bound from {@code app.metrics.*}.
 *
 * <ul>
 *   <li>{@code scrapeToken} (default empty): when set, the endpoint answers only a request that sends
 *       {@code Authorization: Bearer <token>}; scrapers (Prometheus {@code authorization}, vmagent
 *       {@code bearer_token}) send it, and everyone else gets 401. Empty keeps the endpoint
 *       unauthenticated, which then relies on the network (NetworkPolicy) to keep it internal.
 *       Environment variable {@code APP_METRICS_SCRAPE_TOKEN}.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.metrics")
record MetricsProperties(@DefaultValue("") String scrapeToken) {
}
