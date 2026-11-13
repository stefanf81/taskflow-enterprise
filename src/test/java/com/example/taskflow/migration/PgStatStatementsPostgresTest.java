package com.example.taskflow.migration;

import db.migration.V37__enable_pg_stat_statements;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.sql.DriverManager;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Tag("testcontainers")
@Testcontainers
class PgStatStatementsPostgresTest {

    @Container
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18.7-alpine")
            .withDatabaseName("taskflow_test")
            .withUsername("postgres")
            .withPassword("postgres-password")
            .withCommand("postgres", "-c", "shared_preload_libraries=pg_stat_statements");

    @Test
    void flywayInstallsQueryableExtensionAndAcceptsAnExistingInstallation() throws Exception {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/pg-stat-statements-test-only")
                .javaMigrations(new V37__enable_pg_stat_statements())
                .load();

        assertEquals(1, flyway.migrate().migrationsExecuted);
        assertEquals(0, flyway.migrate().migrationsExecuted);

        try (var connection = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             var statement = connection.createStatement()) {
            // Simulate a pre-existing DBA installation: applying V37's body again must be harmless.
            connection.setAutoCommit(false);
            var context = org.mockito.Mockito.mock(org.flywaydb.core.api.migration.Context.class);
            org.mockito.Mockito.when(context.getConnection()).thenReturn(connection);
            new V37__enable_pg_stat_statements().migrate(context);
            connection.commit();
            try (var rs = statement.executeQuery("SELECT count(*) FROM public.pg_stat_statements(true)")) {
                assertTrue(rs.next());
                assertTrue(rs.getLong(1) > 0, "the exporter's statistics function must be queryable");
            }
        }
    }
}
