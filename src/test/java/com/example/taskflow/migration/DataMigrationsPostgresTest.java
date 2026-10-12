package com.example.taskflow.migration;

import com.example.taskflow.testsupport.PostgresTestServer;
import org.junit.jupiter.api.Tag;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Runs the very same data-migration scenarios against a real PostgreSQL server, exercising the
 * PostgreSQL branches (V25 partial index, V32 {@code lower(name)} expression index, ...).
 *
 * <p>Tagged {@code testcontainers}, so the default {@code test} task stays Docker- and server-free;
 * {@code ./gradlew testcontainersTest} runs it against a throw-away container, or against any scratch
 * database named by {@code TASKFLOW_TEST_POSTGRES_URL} (see {@link PostgresTestServer}), e.g.
 * <pre>
 *   TASKFLOW_TEST_POSTGRES_URL=jdbc:postgresql://127.0.0.1:5432/taskflow \
 *   TASKFLOW_TEST_POSTGRES_USER=postgres ./gradlew testcontainersTest --tests '*DataMigrationsPostgresTest'
 * </pre>
 * Every test migrates inside its own freshly created schema, so the database may be reused.
 */
@Tag("testcontainers")
class DataMigrationsPostgresTest extends AbstractDataMigrationsTest {

    private static String baseUrl() {
        return PostgresTestServer.jdbcUrl();
    }

    @Override
    protected String newUrl() throws SQLException {
        String schema = "dm_" + System.nanoTime();
        try (Connection c = DriverManager.getConnection(baseUrl(), user(), password());
             Statement st = c.createStatement()) {
            st.execute("CREATE SCHEMA " + schema);
        }
        return baseUrl() + (baseUrl().contains("?") ? "&" : "?") + "currentSchema=" + schema;
    }

    @Override
    protected String user() {
        return PostgresTestServer.user();
    }

    @Override
    protected String password() {
        return PostgresTestServer.password();
    }

    @Override
    protected boolean isPostgres() {
        return true;
    }

    @Override
    protected String indexNamesSql() {
        return "SELECT lower(indexname) FROM pg_indexes WHERE schemaname = current_schema()";
    }
}
