package com.example.taskflow.core;

import io.micrometer.core.instrument.Timer;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.micrometer.metrics.autoconfigure.CompositeMeterRegistryAutoConfiguration;
import org.springframework.boot.micrometer.metrics.autoconfigure.MetricsAutoConfiguration;
import org.springframework.boot.micrometer.metrics.autoconfigure.export.prometheus.PrometheusMetricsExportAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The prod profile's {@code management.metrics.distribution.*} lines must actually shape
 * {@code http.server.requests} in {@code /actuator/prometheus}: the SLO boundaries 50/100/200 ms
 * exist as buckets, so they are exact in {@code histogram_quantile()} and countable per SLO. With the
 * former key {@code sla} (ignored since its rename to {@code slo}) none of the three was published.
 */
class ProdHttpServerRequestsHistogramTest {

    @Test
    void prodDistributionSettingsPublishTheSloBuckets() throws IOException {
        Properties prod = new Properties();
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("application-prod.properties")) {
            prod.load(in);
        }
        String[] distribution = prod.stringPropertyNames().stream()
                .filter(key -> key.startsWith("management.metrics.distribution."))
                .map(key -> key + "=" + prod.getProperty(key))
                .toArray(String[]::new);
        assertThat(distribution).isNotEmpty();

        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(MetricsAutoConfiguration.class,
                        CompositeMeterRegistryAutoConfiguration.class, PrometheusMetricsExportAutoConfiguration.class))
                .withPropertyValues(distribution)
                .run(context -> {
                    PrometheusMeterRegistry registry = context.getBean(PrometheusMeterRegistry.class);
                    Timer.builder("http.server.requests").tag("uri", "/api/v1/catalog").register(registry)
                            .record(Duration.ofMillis(30));

                    String buckets = registry.scrape().lines()
                            .filter(line -> line.startsWith("http_server_requests_seconds_bucket"))
                            .reduce("", (a, b) -> a + b + "\n");
                    assertThat(buckets).as("percentiles-histogram publishes buckets").contains("le=\"+Inf\"");
                    assertThat(buckets).contains("le=\"0.05\"", "le=\"0.1\"", "le=\"0.2\"");
                });
    }
}
