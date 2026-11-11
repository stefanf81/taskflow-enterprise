package com.example.taskflow.core.telemetry;

import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.micrometer.metrics.autoconfigure.CompositeMeterRegistryAutoConfiguration;
import org.springframework.boot.micrometer.metrics.autoconfigure.MetricsAutoConfiguration;
import org.springframework.boot.micrometer.metrics.autoconfigure.export.prometheus.PrometheusMetricsExportAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Properties;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The prod profile publishes {@code taskflow.client.performance} with buckets at the Core Web Vitals
 * thresholds, so the share of page loads under each one can be computed in Prometheus. A plain
 * summary (what the controller registers) only exports count, sum and max.
 */
class ClientTelemetrySloBucketsTest {

    @Test
    void prodProfilePublishesTheWebVitalsThresholdsAsBuckets() throws IOException {
        Properties prod = new Properties();
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("application-prod.properties")) {
            prod.load(in);
        }
        String[] distribution = prod.stringPropertyNames().stream()
                .filter(key -> key.startsWith("management.metrics.distribution."))
                .map(key -> key + "=" + prod.getProperty(key))
                .toArray(String[]::new);

        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(MetricsAutoConfiguration.class,
                        CompositeMeterRegistryAutoConfiguration.class, PrometheusMetricsExportAutoConfiguration.class))
                .withPropertyValues(distribution)
                .run(context -> {
                    PrometheusMeterRegistry registry = context.getBean(PrometheusMeterRegistry.class);
                    // Registered exactly as ClientTelemetryController does.
                    DistributionSummary lcp = registry.summary("taskflow.client.performance",
                            "platform", "WEB", "route", "LANDING", "name", "LCP");
                    lcp.record(2100);
                    lcp.record(3600);

                    String buckets = registry.scrape().lines()
                            .filter(line -> line.startsWith("taskflow_client_performance_bucket"))
                            .reduce("", (a, b) -> a + b + "\n");
                    List<Double> bounds = Pattern.compile("le=\"([0-9.]+)\"").matcher(buckets).results()
                            .map(match -> Double.valueOf(match.group(1)))
                            .toList();
                    assertThat(bounds).containsExactly(0.1, 0.25, 200.0, 500.0, 800.0, 1800.0, 2500.0, 3000.0, 4000.0);
                    // Cumulative: the 2.1 s load is under the LCP "good" threshold, the 3.6 s one is not.
                    assertThat(buckets).containsPattern("le=\"2500\\.0\"[^\\n]*\\} 1(\\.0)?\\n");
                    assertThat(buckets).containsPattern("le=\"4000\\.0\"[^\\n]*\\} 2(\\.0)?\\n");
                });
    }
}
