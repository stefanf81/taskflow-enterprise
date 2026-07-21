package com.example.cdstraining;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Import;

import com.example.taskflow.core.CacheConfig;

/**
 * Minimal application context used only while generating the JVM CDS archive.
 *
 * <p>This class deliberately sits outside the production application's component-scan
 * hierarchy. It excludes infrastructure requiring external services (database, OTLP
 * collector), so image builds do not contact them.</p>
 *
 * <p>Redis auto-configuration is intentionally <b>not</b> excluded and {@link CacheConfig}
 * is imported so the {@code RedisCacheManager} / {@code GenericJackson2JsonRedisSerializer}
 * bean graph is instantiated during training and its classes land in the CDS archive.
 * No real Redis connection is opened: Lettuce connects lazily and the context is terminated
 * at refresh via {@code spring.context.exit=onRefresh} (set in the Dockerfile) before any
 * cache read or write executes.</p>
 */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration(excludeName = {
        "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration",
        "org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration",
        "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration",
        "org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.observation.ObservationAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.tracing.MicrometerTracingAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.opentelemetry.OpenTelemetryAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.tracing.otlp.OtlpTracingAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.metrics.export.otlp.OtlpMetricsExportAutoConfiguration",
        "org.springframework.boot.actuate.autoconfigure.logging.otlp.OtlpLoggingAutoConfiguration",
        "org.springframework.boot.webmvc.autoconfigure.WebMvcObservationAutoConfiguration",
        "org.springframework.boot.micrometer.observation.autoconfigure.ObservationAutoConfiguration",
        "org.springframework.boot.micrometer.tracing.autoconfigure.MicrometerTracingAutoConfiguration",
        "org.springframework.boot.micrometer.tracing.opentelemetry.autoconfigure.OpenTelemetryTracingAutoConfiguration",
        "org.springframework.boot.micrometer.tracing.opentelemetry.autoconfigure.otlp.OtlpTracingAutoConfiguration",
        "org.springframework.boot.micrometer.tracing.opentelemetry.autoconfigure.zipkin.ZipkinWithOpenTelemetryTracingAutoConfiguration",
        "org.springframework.boot.micrometer.metrics.autoconfigure.export.otlp.OtlpMetricsExportAutoConfiguration",
        "org.springframework.boot.micrometer.tracing.autoconfigure.otlp.OtlpExemplarsAutoConfiguration",
        "org.springframework.boot.opentelemetry.autoconfigure.OpenTelemetrySdkAutoConfiguration",
        "org.springframework.boot.opentelemetry.autoconfigure.logging.OpenTelemetryLoggingAutoConfiguration",
        "org.springframework.boot.opentelemetry.autoconfigure.logging.otlp.OtlpLoggingAutoConfiguration"
})
@EnableCaching
@Import(CacheConfig.class)
public class CdsTrainingApplication {

    public static void main(String[] args) {
        SpringApplication.run(CdsTrainingApplication.class, args);
    }
}
