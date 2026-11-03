package com.example.taskflow.notification;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** Registers the notification module's {@code app.notification.*} and {@code app.instance.*} properties. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({NotificationProperties.class, InstanceProperties.class})
class NotificationConfig {
}
