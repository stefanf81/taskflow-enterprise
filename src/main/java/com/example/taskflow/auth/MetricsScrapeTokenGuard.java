package com.example.taskflow.auth;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Refuses to start an instance that is meant to authenticate its metrics scrape but has no usable
 * {@code app.metrics.scrape-token}: without one {@link MetricsScrapeAuthorization} leaves
 * {@code GET /actuator/prometheus} open and only the network keeps it internal.
 *
 * <p>Enabled by {@code app.metrics.require-scrape-token=true} ({@code APP_REQUIRE_METRICS_SCRAPE_TOKEN}
 * in the prod profile), like {@link AdminPasswordGuard}. It is off by default: a deployment turns
 * it on in the same change that gives the backend and its scraper the token, so that a secret key
 * lost or renamed later stops the rollout instead of silently reopening the endpoint
 * (https://github.com/stefanf81/taskflow-enterprise/issues/223).
 */
@Component
@ConditionalOnProperty(name = "app.metrics.require-scrape-token", havingValue = "true")
class MetricsScrapeTokenGuard {

    /** {@code openssl rand -hex 24} gives 48 characters; shorter than this is a placeholder or a typo. */
    static final int MIN_TOKEN_LENGTH = 16;

    MetricsScrapeTokenGuard(MetricsProperties metrics) {
        validate(metrics.scrapeToken());
    }

    static void validate(String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalStateException(
                    "APP_METRICS_SCRAPE_TOKEN must be set in this environment (app.metrics.require-scrape-token=true): "
                            + "without it GET /actuator/prometheus is unauthenticated.");
        }
        if (token.contains("CHANGE_ME") || token.strip().length() < MIN_TOKEN_LENGTH) {
            throw new IllegalStateException(
                    "APP_METRICS_SCRAPE_TOKEN is a placeholder or shorter than " + MIN_TOKEN_LENGTH
                            + " characters; generate one with `openssl rand -hex 24`.");
        }
    }
}
