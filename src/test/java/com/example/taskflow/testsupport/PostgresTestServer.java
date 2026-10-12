package com.example.taskflow.testsupport;

import org.testcontainers.containers.PostgreSQLContainer;

import java.net.URI;

/**
 * The PostgreSQL server for the {@code @Tag("testcontainers")} tests that create their own schemas or
 * databases. {@code TASKFLOW_TEST_POSTGRES_URL} (plus {@code _USER}/{@code _PASSWORD}) points them at
 * an existing server; otherwise one throw-away container is started per JVM on first use, so
 * {@code ./gradlew testcontainersTest} runs them in CI instead of skipping them.
 */
public final class PostgresTestServer {

    private static final String URL = System.getenv("TASKFLOW_TEST_POSTGRES_URL");

    private static PostgreSQLContainer container;

    private PostgresTestServer() {
    }

    /** JDBC URL of the server's default database, e.g. {@code jdbc:postgresql://host:port/postgres}. */
    public static String jdbcUrl() {
        return hasExternalServer() ? URL : container().getJdbcUrl();
    }

    public static String user() {
        return hasExternalServer()
                ? System.getenv().getOrDefault("TASKFLOW_TEST_POSTGRES_USER", "postgres")
                : container().getUsername();
    }

    public static String password() {
        return hasExternalServer()
                ? System.getenv().getOrDefault("TASKFLOW_TEST_POSTGRES_PASSWORD", "")
                : container().getPassword();
    }

    /** {@link #jdbcUrl()} without the {@code jdbc:} prefix, for host, port and database name. */
    public static URI uri() {
        return URI.create(jdbcUrl().substring("jdbc:".length()));
    }

    private static boolean hasExternalServer() {
        return URL != null && !URL.isBlank();
    }

    private static synchronized PostgreSQLContainer container() {
        if (container == null) {
            PostgreSQLContainer started = new PostgreSQLContainer("postgres:18.6-alpine")
                    .withDatabaseName("postgres")
                    .withUsername("postgres")
                    .withPassword("postgres-password");
            started.start();
            container = started;
        }
        return container;
    }
}
