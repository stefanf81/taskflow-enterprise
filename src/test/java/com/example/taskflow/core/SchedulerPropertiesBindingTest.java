package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/** {@code app.schedulers.enabled} and {@code app.shop.time-zone} keep their keys and defaults. */
class SchedulerPropertiesBindingTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(SchedulerConfig.class, ClockConfig.class);

    /**
     * Bound from an empty source: the Gradle {@code test} task sets the system property
     * {@code app.schedulers.enabled=false}, which a context would see.
     */
    @Test
    void schedulersAreEnabledByDefault() {
        Binder empty = new Binder(new MapConfigurationPropertySource());

        assertThat(empty.bindOrCreate("app.schedulers", SchedulerProperties.class).enabled()).isTrue();
        assertThat(empty.bindOrCreate("app.shop", ShopProperties.class).timeZone()).isEqualTo("UTC");
    }

    @Test
    void theKeysAreBound() {
        runner.withPropertyValues("app.schedulers.enabled=false", "app.shop.time-zone=Europe/Berlin")
                .run(context -> {
                    assertThat(context.getBean(SchedulerProperties.class).enabled()).isFalse();
                    assertThat(context.getBean(ShopProperties.class).timeZone()).isEqualTo("Europe/Berlin");
                });
        runner.withPropertyValues("app.schedulers.enabled=true")
                .run(context -> assertThat(context.getBean(SchedulerProperties.class).enabled()).isTrue());
    }
}
