package com.example.cdstraining;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;

/**
 * Minimal application context used only while generating the JVM CDS archive.
 *
 * <p>This class deliberately sits outside the production application's component-scan
 * hierarchy. It excludes infrastructure requiring external services, so image builds do
 * not contact the database, Redis, or OTLP collector.</p>
 */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration(excludeName = {
        "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration",
        "org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration",
        "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration",
        "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.observation.ObservationAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.tracing.MicrometerTracingAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.opentelemetry.OpenTelemetryAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.tracing.otlp.OtlpTracingAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.metrics.export.otlp.OtlpMetricsExportAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.logging.otlp.OtlpLoggingAutoConfiguration"
})
public class CdsTrainingApplication {

    public static void main(String[] args) {
        SpringApplication.run(CdsTrainingApplication.class, args);
    }
}
