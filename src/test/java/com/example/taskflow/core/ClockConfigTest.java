package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

class ClockConfigTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(ClockConfig.class);

    @Test
    void defaultsToUtc() {
        runner.run(context -> assertThat(context.getBean(Clock.class).getZone()).isEqualTo(ZoneId.of("UTC")));
    }

    @Test
    void usesTheConfiguredShopTimeZone() {
        runner.withPropertyValues("app.shop.time-zone=America/New_York")
                .run(context -> assertThat(context.getBean(Clock.class).getZone())
                        .isEqualTo(ZoneId.of("America/New_York")));
    }

    @Test
    void anUnknownTimeZoneFailsStartup() {
        runner.withPropertyValues("app.shop.time-zone=Mars/Olympus_Mons")
                .run(context -> assertThat(context).hasFailed()
                        .getFailure().rootCause().isInstanceOf(DateTimeException.class));
    }
}
