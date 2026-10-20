package com.example.taskflow.core;

import io.micrometer.core.instrument.LongTaskTimer;
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
import java.util.Collections;
import java.util.List;
import java.util.Properties;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The prod profile's {@code management.metrics.distribution.*} lines must actually shape
 * {@code http.server.requests} in {@code /actuator/prometheus}: the SLO boundaries 50/100/200 ms
 * exist as buckets, so they are exact in {@code histogram_quantile()} and countable per SLO, and the
 * buckets end at the 10 s maximum expected value. With the former key {@code sla} (ignored since its
 * rename to {@code slo}) none of the three was published.
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
                    // The observation also registers this long task timer: the distribution keys are
                    // prefixes, and an invalid range for it failed every request.
                    LongTaskTimer.builder("http.server.requests.active").tag("uri", "/api/v1/catalog")
                            .register(registry).start().stop();

                    String scrape = registry.scrape();
                    String buckets = scrape.lines()
                            .filter(line -> line.startsWith("http_server_requests_seconds_bucket"))
                            .reduce("", (a, b) -> a + b + "\n");
                    assertThat(scrape).contains("http_server_requests_active_seconds_bucket");
                    assertThat(buckets).as("percentiles-histogram publishes buckets").contains("le=\"+Inf\"");
                    assertThat(buckets).contains("le=\"0.05\"", "le=\"0.1\"", "le=\"0.2\"");

                    // maximum-expected-value=10s: the highest finite bucket is 10 s (default 30 s)
                    List<Double> bounds = Pattern.compile("le=\"([0-9.]+)\"").matcher(buckets).results()
                            .map(match -> Double.valueOf(match.group(1)))
                            .toList();
                    assertThat(Collections.max(bounds)).isEqualTo(10.0);
                    assertThat(bounds).as("finite buckets incl. the 3 SLO boundaries").hasSize(63);
                });
    }
}
