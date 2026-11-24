package com.example.taskflow.testsupport;

import java.util.List;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.EnumerablePropertySource;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;

/**
 * Points every Spring context of the {@code test} task at its own PostgreSQL database.
 *
 * <p>Active only when the {@code taskflow.test.postgres} system property is {@code true}, which
 * build.gradle sets for {@code test}; {@code testcontainersTest}, {@code benchmarkTest} and IDE runs of
 * single classes without it keep the application's defaults. A test that names its own
 * {@code spring.datasource.url} in {@code @SpringBootTest(properties = …)} (the H2 smoke tests) or
 * through {@code @DynamicPropertySource} keeps it: this source sits below both.
 *
 * <p>The database is created lazily, on the first read of a datasource property, so a slice test that
 * never builds a {@code DataSource} creates none and does not start the container.
 */
public final class PostgresTestDatabaseEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    static final String ENABLED_PROPERTY = "taskflow.test.postgres";

    /** {@code TestPropertySourceUtils.INLINED_PROPERTIES_PROPERTY_SOURCE_NAME}. */
    private static final String INLINED_TEST_PROPERTIES = "Inlined Test Properties";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (!Boolean.getBoolean(ENABLED_PROPERTY)) {
            return;
        }
        MutablePropertySources sources = environment.getPropertySources();
        PropertySource<?> inlined = sources.get(INLINED_TEST_PROPERTIES);
        if (inlined != null && inlined.containsProperty("spring.datasource.url")) {
            return;
        }
        String[] locations = environment.getProperty(
                "spring.flyway.locations", String[].class, new String[] {"classpath:db/migration"});
        LazyDatabase source = new LazyDatabase(List.of(locations));
        if (inlined != null) {
            sources.addAfter(INLINED_TEST_PROPERTIES, source);
        } else {
            sources.addFirst(source);
        }
    }

    /** After ConfigDataEnvironmentPostProcessor, so spring.flyway.locations is readable. */
    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }

    private static final class LazyDatabase extends EnumerablePropertySource<Object> {

        private static final String URL = "spring.datasource.url";

        private static final String[] NAMES = {
            URL,
            "spring.datasource.driver-class-name",
            "spring.datasource.username",
            "spring.datasource.password",
            "spring.datasource.hikari.maximum-pool-size",
            "spring.datasource.hikari.minimum-idle",
            "spring.datasource.hikari.idle-timeout",
        };

        private final List<String> flywayLocations;

        private String url;

        LazyDatabase(List<String> flywayLocations) {
            super("taskflowTestPostgresDatabase", new Object());
            this.flywayLocations = flywayLocations;
        }

        @Override
        public String[] getPropertyNames() {
            return NAMES.clone();
        }

        @Override
        public Object getProperty(String name) {
            return switch (name) {
                case URL -> url();
                case "spring.datasource.driver-class-name" -> "org.postgresql.Driver";
                case "spring.datasource.username" -> PostgresTestServer.user();
                case "spring.datasource.password" -> PostgresTestServer.password();
                case "spring.datasource.hikari.maximum-pool-size" -> PostgresTestDatabases.HIKARI_MAXIMUM_POOL_SIZE;
                case "spring.datasource.hikari.minimum-idle" -> PostgresTestDatabases.HIKARI_MINIMUM_IDLE;
                case "spring.datasource.hikari.idle-timeout" -> PostgresTestDatabases.HIKARI_IDLE_TIMEOUT_MS;
                default -> null;
            };
        }

        private synchronized String url() {
            if (url == null) {
                url = PostgresTestDatabases.createDatabase(flywayLocations);
            }
            return url;
        }
    }
}
