package com.example.taskflow.notification;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/** {@code app.notification.*} and {@code app.instance.*} keep their keys and defaults. */
class NotificationPropertiesBindingTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(NotificationConfig.class);

    @Test
    void defaultsAreTheFormerValueDefaults() {
        runner.run(context -> {
            assertThat(context.getBean(NotificationProperties.class))
                    .isEqualTo(new NotificationProperties(30, "0 30 3 * * *", false, NotificationProperties.Gateway.SIMULATED));
            assertThat(context.getBean(InstanceProperties.class).id()).isNull();
        });
    }

    @Test
    void theKeysAreBound() {
        runner.withPropertyValues("app.notification.retention-days=7", "app.notification.retention-cron=0 0 1 * * *",
                        "app.notification.simulate-failures=true", "app.instance.id=replica-1")
                .run(context -> {
                    assertThat(context.getBean(NotificationProperties.class))
                            .isEqualTo(new NotificationProperties(7, "0 0 1 * * *", true, NotificationProperties.Gateway.SIMULATED));
                    assertThat(context.getBean(InstanceProperties.class).id()).isEqualTo("replica-1");
                });
    }
}
