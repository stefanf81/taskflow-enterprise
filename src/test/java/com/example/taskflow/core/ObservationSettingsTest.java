package com.example.taskflow.core;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationHandler;
import io.micrometer.observation.ObservationRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.micrometer.observation.autoconfigure.ObservationAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The observations switched off in {@code application.properties} for throughput (Spring Security's
 * per-filter observations and Lettuce's per-command observation) must really be off, while the HTTP
 * server observation behind {@code http.server.requests} metrics and traces stays on.
 */
class ObservationSettingsTest {

    @Test
    void perFilterAndPerRedisCommandObservationsAreOffButHttpServerRequestsAreOn() throws IOException {
        Properties base = new Properties();
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("application.properties")) {
            base.load(in);
        }
        String[] observations = base.stringPropertyNames().stream()
                .filter(key -> key.startsWith("management.observations."))
                .map(key -> key + "=" + base.getProperty(key))
                .toArray(String[]::new);

        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ObservationAutoConfiguration.class))
                .withPropertyValues(observations)
                // without any handler every observation is a no-op, enabled or not
                .withBean(AnyContextHandler.class, AnyContextHandler::new)
                .run(context -> {
                    ObservationRegistry registry = context.getBean(ObservationRegistry.class);

                    assertThat(Observation.createNotStarted("lettuce", registry).isNoop()).isTrue();
                    assertThat(Observation.createNotStarted("spring.security.filterchains", registry).isNoop())
                            .isTrue();
                    assertThat(Observation.createNotStarted("http.server.requests", registry).isNoop()).isFalse();
                });
    }

    static class AnyContextHandler implements ObservationHandler<Observation.Context> {
        @Override
        public boolean supportsContext(Observation.Context context) {
            return true;
        }
    }
}
