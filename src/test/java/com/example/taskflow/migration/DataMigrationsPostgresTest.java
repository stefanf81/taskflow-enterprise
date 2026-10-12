package com.example.taskflow.migration;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Runs the very same data-migration scenarios against a real PostgreSQL server, exercising the
 * PostgreSQL branches (V25 partial index, V32 {@code lower(name)} expression index, ...).
 *
 * <p>Skipped unless {@code TASKFLOW_TEST_POSTGRES_URL} is set, so the default {@code test} task stays
 * Docker- and server-free. Point it at any scratch database, e.g.
 * <pre>
 *   TASKFLOW_TEST_POSTGRES_URL=jdbc:postgresql://127.0.0.1:5432/taskflow \
 *   TASKFLOW_TEST_POSTGRES_USER=postgres ./gradlew test --tests '*DataMigrationsPostgresTest'
 * </pre>
 * Every test migrates inside its own freshly created schema, so the database may be reused.
 */
@EnabledIfEnvironmentVariable(named = "TASKFLOW_TEST_POSTGRES_URL", matches = ".+")
class DataMigrationsPostgresTest extends AbstractDataMigrationsTest {

    private static String baseUrl() {
        return System.getenv("TASKFLOW_TEST_POSTGRES_URL");
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
        String user = System.getenv("TASKFLOW_TEST_POSTGRES_USER");
        return user == null ? "postgres" : user;
    }

    @Override
    protected String password() {
        String password = System.getenv("TASKFLOW_TEST_POSTGRES_PASSWORD");
        return password == null ? "" : password;
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
