package com.example.taskflow.core.web;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/** The per-IP limits keep their {@code app.rate-limit.*} keys and defaults. */
class RateLimitPropertiesBindingTest {

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(RateLimitProperties.class)
    static class Properties {
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Properties.class);

    @Test
    void defaultsAreTheFormerValueDefaults() {
        runner.run(context -> assertThat(context.getBean(RateLimitProperties.class))
                .isEqualTo(new RateLimitProperties(false, 100, 20)));
    }

    @Test
    void theKeysAreBoundAndTheLoginKeysAreLeftToTheAuthModule() {
        runner.withPropertyValues("app.rate-limit.enabled=true", "app.rate-limit.max-requests-per-minute=7",
                        "app.rate-limit.auth-max-requests-per-minute=3", "app.rate-limit.login-max-failures=2")
                .run(context -> assertThat(context.getBean(RateLimitProperties.class))
                        .isEqualTo(new RateLimitProperties(true, 7, 3)));
    }
}
