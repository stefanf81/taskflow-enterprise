package com.example.taskflow.core;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** Registers {@link SchedulerProperties}, which the scheduled jobs of every module read. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SchedulerProperties.class)
class SchedulerConfig {
}
