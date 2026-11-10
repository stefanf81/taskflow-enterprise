package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The auth module's {@code app.*} records keep the keys and defaults of the {@code @Value}
 * injections they replaced.
 */
class AuthPropertiesBindingTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(AuthPropertiesConfig.class);

    @Test
    void defaultsAreTheFormerValueDefaults() {
        runner.run(context -> {
            assertThat(context.getBean(JwtProperties.class))
                    .isEqualTo(new JwtProperties("taskflow", "taskflow-api", 3600));
            // ${app.rsa.private-key:#{null}}: absent means null, not an empty string
            assertThat(context.getBean(RsaKeyProperties.class)).isEqualTo(new RsaKeyProperties(null, null, false));
            assertThat(context.getBean(CookieProperties.class).secure()).isTrue();
            assertThat(context.getBean(CorsProperties.class).allowedOrigins())
                    .isEqualTo("http://localhost:4200,http://127.0.0.1:4200");
            assertThat(context.getBean(LoginThrottleProperties.class))
                    .isEqualTo(new LoginThrottleProperties(10, 300));
            // No scrape token: /actuator/prometheus stays open (MetricsScrapeAuthorization).
            assertThat(context.getBean(MetricsProperties.class)).isEqualTo(new MetricsProperties(""));
        });
    }

    @Test
    void theKeysAreBound() {
        runner.withPropertyValues(
                        "app.jwt.issuer=issuer", "app.jwt.audience=audience", "app.jwt.lifetime-seconds=60",
                        "app.rsa.private-key=private", "app.rsa.public-key=public", "app.rsa.require-persistent-keys=true",
                        "app.cookie.secure=false", "app.cors.allowed-origins=https://shop.example",
                        "app.rate-limit.login-max-failures=3", "app.rate-limit.login-failure-window-seconds=30",
                        "app.metrics.scrape-token=token")
                .run(context -> {
                    assertThat(context.getBean(JwtProperties.class)).isEqualTo(new JwtProperties("issuer", "audience", 60));
                    assertThat(context.getBean(RsaKeyProperties.class))
                            .isEqualTo(new RsaKeyProperties("private", "public", true))
                            .hasToString("RsaKeyProperties[privateKey=[REDACTED], publicKey=public, requirePersistentKeys=true]");
                    assertThat(context.getBean(CookieProperties.class).secure()).isFalse();
                    assertThat(context.getBean(CorsProperties.class).allowedOrigins()).isEqualTo("https://shop.example");
                    assertThat(context.getBean(LoginThrottleProperties.class)).isEqualTo(new LoginThrottleProperties(3, 30));
                    assertThat(context.getBean(MetricsProperties.class))
                            .isEqualTo(new MetricsProperties("token"))
                            .hasToString("MetricsProperties[scrapeToken=[REDACTED]]");
                });
    }

    /** Prod: app.cors.allowed-origins=${APP_CORS_ALLOWED_ORIGINS:} with the variable unset must still abort. */
    @Test
    void anEmptyCorsListStillFailsTheStart() {
        runner.withUserConfiguration(CorsConfig.class)
                .withPropertyValues("app.cors.allowed-origins=")
                .run(context -> assertThat(context).hasFailed().getFailure().rootCause()
                        .isInstanceOf(IllegalStateException.class)
                        .hasMessageContaining("app.cors.allowed-origins"));
    }

    /** Prod: app.rsa.require-persistent-keys=true with ${APP_RSA_PRIVATE_KEY:} unset must still abort. */
    @Test
    void requiredPersistentKeysThatAreEmptyStillFailTheStart() {
        runner.withPropertyValues("app.rsa.private-key=", "app.rsa.public-key=", "app.rsa.require-persistent-keys=true")
                .run(context -> {
                    RsaKeyProperties keys = context.getBean(RsaKeyProperties.class);
                    assertThat(keys.privateKey()).isNullOrEmpty();
                    assertThat(keys.publicKey()).isNullOrEmpty();
                    org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () -> new SecurityConfig(
                            "admin", "pass", keys, context.getBean(JwtProperties.class),
                            context.getBean(CookieProperties.class)));
                });
    }
}
