package com.example.taskflow.appointment.stream;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** Registers {@link SseProperties}. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SseProperties.class)
class SseConfig {
}
