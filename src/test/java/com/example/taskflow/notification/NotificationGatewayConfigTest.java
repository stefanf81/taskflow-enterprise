package com.example.taskflow.notification;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

@ExtendWith(OutputCaptureExtension.class)
class NotificationGatewayConfigTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(NotificationConfig.class, NotificationGatewayConfig.class);

    private ApplicationContextRunner smtp() {
        return runner.withPropertyValues("app.notification.gateway=smtp", "app.notification.smtp.host=smtp.invalid",
                "app.notification.smtp.from=bookings@example.com");
    }

    @Test
    void defaultGatewayIsOfflineAndNeedsNoMailConfiguration() {
        runner.run(context -> {
            assertThat(context).hasSingleBean(NotificationGateway.class);
            assertThat(context.getBean(NotificationGateway.class)).isInstanceOf(SimulatedNotificationGateway.class);
            assertThat(context).doesNotHaveBean(JavaMailSender.class);
            assertThat(context).doesNotHaveBean(NotificationSmtpProperties.class);
        });
    }

    @Test
    void prodSimulationWarnsInsteadOfBreakingSmokeTests(CapturedOutput output) {
        runner.withPropertyValues("spring.profiles.active=prod").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(output).contains("Notification gateway is SIMULATED", "app.notification.gateway=smtp");
        });
    }

    @Test
    void smtpCreatesBoundedAuthenticatedTlsSenderWithoutMakingAConnection() {
        smtp().withPropertyValues("app.notification.smtp.username=test-account", "app.notification.smtp.password=test-secret",
                        "app.notification.smtp.connect-timeout-ms=1234", "app.notification.smtp.read-timeout-ms=2345",
                        "app.notification.smtp.write-timeout-ms=3456")
                .run(context -> {
                    assertThat(context).hasSingleBean(NotificationGateway.class);
                    assertThat(context.getBean(NotificationGateway.class)).isInstanceOf(SmtpNotificationGateway.class);
                    JavaMailSenderImpl sender = (JavaMailSenderImpl) context.getBean(JavaMailSender.class);
                    assertThat(sender.getHost()).isEqualTo("smtp.invalid");
                    assertThat(sender.getPort()).isEqualTo(587);
                    assertThat(sender.getUsername()).isEqualTo("test-account");
                    assertThat(sender.getPassword()).isEqualTo("test-secret");
                    assertThat(sender.getJavaMailProperties())
                            .containsEntry("mail.smtp.connectiontimeout", "1234")
                            .containsEntry("mail.smtp.timeout", "2345")
                            .containsEntry("mail.smtp.writetimeout", "3456")
                            .containsEntry("mail.smtp.auth", "true")
                            .containsEntry("mail.smtp.starttls.enable", "true")
                            .containsEntry("mail.smtp.starttls.required", "true")
                            .containsEntry("mail.smtp.ssl.checkserveridentity", "true")
                            .containsEntry("mail.debug", "false");
                    assertThat(context.getBean(NotificationSmtpProperties.class).toString()).doesNotContain("test-secret");
                });
    }

    @Test
    void implicitTlsAndLocalCaptureAreExplicitChoices() {
        smtp().withPropertyValues("app.notification.smtp.ssl=true", "app.notification.smtp.port=465")
                .run(context -> {
                    JavaMailSenderImpl sender = (JavaMailSenderImpl) context.getBean(JavaMailSender.class);
                    assertThat(sender.getPort()).isEqualTo(465);
                    assertThat(sender.getJavaMailProperties()).containsEntry("mail.smtp.ssl.enable", "true")
                            .containsEntry("mail.smtp.starttls.required", "false");
                });
        smtp().withPropertyValues("app.notification.smtp.start-tls=false", "app.notification.smtp.port=1025")
                .run(context -> {
                    JavaMailSenderImpl sender = (JavaMailSenderImpl) context.getBean(JavaMailSender.class);
                    assertThat(sender.getJavaMailProperties()).containsEntry("mail.smtp.auth", "false")
                            .containsEntry("mail.smtp.starttls.enable", "false");
                });
    }

    @Test
    void smtpRequiresHostAndSender() {
        runner.withPropertyValues("app.notification.gateway=smtp").run(context -> assertThat(context).hasFailed());
        smtp().withPropertyValues("app.notification.smtp.from=not-an-email")
                .run(context -> assertThat(context).hasFailed());
    }

    @ParameterizedTest
    @ValueSource(strings = {"connect-timeout-ms=0", "read-timeout-ms=-1", "write-timeout-ms=10001", "port=65536"})
    void smtpRejectsUnboundedOrInvalidTransportSettings(String setting) {
        smtp().withPropertyValues("app.notification.smtp." + setting)
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void unknownGatewayFailsFastRatherThanSilentlySimulating() {
        runner.withPropertyValues("app.notification.gateway=smpt").run(context -> assertThat(context).hasFailed());
    }

    @Test
    void simulationFailureHookIsOffByDefaultAndCanBeEnabledForTests() {
        var message = new NotificationGateway.Message(1L, "invalid.joe@example.com", "EMAIL", "private body");
        assertDoesNotThrow(() -> new SimulatedNotificationGateway(false).send(message));
        assertThrows(IllegalStateException.class, () -> new SimulatedNotificationGateway(true).send(message));
    }
}
