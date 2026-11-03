package com.example.taskflow.appointment.stream;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/** {@code app.sse.*} keeps its keys and defaults. */
class SsePropertiesBindingTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(SseConfig.class);

    @Test
    void defaultsAreTheFormerValueDefaults() {
        runner.run(context -> assertThat(context.getBean(SseProperties.class)).isEqualTo(new SseProperties(2, 20000)));
    }

    @Test
    void theKeysAreBound() {
        runner.withPropertyValues("app.sse.max-connections-per-admin=5", "app.sse.heartbeat-interval-ms=1000")
                .run(context -> assertThat(context.getBean(SseProperties.class)).isEqualTo(new SseProperties(5, 1000)));
    }
}
