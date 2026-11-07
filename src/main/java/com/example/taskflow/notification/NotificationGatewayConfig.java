package com.example.taskflow.notification;

import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.nio.charset.StandardCharsets;
import java.util.Properties;

@Configuration(proxyBeanMethods = false)
class NotificationGatewayConfig {

    @Bean
    @ConditionalOnProperty(name = "app.notification.gateway", havingValue = "simulated", matchIfMissing = true)
    NotificationGateway simulatedNotificationGateway(NotificationProperties properties, Environment environment) {
        if (environment.acceptsProfiles(Profiles.of("prod"))) {
            LoggerFactory.getLogger(NotificationGatewayConfig.class).warn(
                    "Notification gateway is SIMULATED: no email will be delivered. Production must configure app.notification.gateway=smtp.");
        }
        return new SimulatedNotificationGateway(properties.simulateFailures());
    }

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnProperty(name = "app.notification.gateway", havingValue = "smtp")
    @EnableConfigurationProperties(NotificationSmtpProperties.class)
    static class SmtpConfig {

        @Bean
        JavaMailSender notificationMailSender(NotificationSmtpProperties properties) {
            JavaMailSenderImpl sender = new JavaMailSenderImpl();
            sender.setHost(properties.host());
            sender.setPort(properties.port());
            sender.setProtocol("smtp");
            sender.setDefaultEncoding(StandardCharsets.UTF_8.name());
            sender.setUsername(properties.username());
            sender.setPassword(properties.password());
            Properties mail = new Properties();
            mail.setProperty("mail.smtp.auth", Boolean.toString(
                    properties.username() != null && !properties.username().isBlank()));
            mail.setProperty("mail.smtp.starttls.enable", Boolean.toString(properties.startTls() && !properties.ssl()));
            mail.setProperty("mail.smtp.starttls.required", Boolean.toString(properties.startTls() && !properties.ssl()));
            mail.setProperty("mail.smtp.ssl.enable", Boolean.toString(properties.ssl()));
            mail.setProperty("mail.smtp.ssl.checkserveridentity", "true");
            mail.setProperty("mail.smtp.connectiontimeout", Integer.toString(properties.connectTimeoutMs()));
            mail.setProperty("mail.smtp.timeout", Integer.toString(properties.readTimeoutMs()));
            mail.setProperty("mail.smtp.writetimeout", Integer.toString(properties.writeTimeoutMs()));
            mail.setProperty("mail.debug", "false");
            sender.setJavaMailProperties(mail);
            // No testConnection(): context refresh, including offline AOT training, must not send/connect.
            return sender;
        }

        @Bean
        NotificationGateway smtpNotificationGateway(JavaMailSender mailSender, NotificationSmtpProperties properties) {
            return new SmtpNotificationGateway(mailSender, properties.from());
        }
    }
}
