package com.example.taskflow.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The application's default profile on in-memory H2, the database the Dockerfile's AOT-cache training
 * run and {@code ./gradlew bootRun} boot offline. Every other Spring-context test runs on PostgreSQL
 * (testsupport/PostgresTestDatabases), so this is what keeps the H2 branches of the Java migrations
 * (V21, V25, …) and Hibernate's validation against the H2 schema from breaking the image build
 * unnoticed.
 */
@SpringBootTest(
        properties = {
            "app.rate-limit.enabled=false",
            "app.schedulers.enabled=false",
            // Pinned explicitly, so PostgresTestDatabaseEnvironmentPostProcessor leaves it alone.
            "spring.datasource.url=jdbc:h2:mem:h2-default-profile-smoke;MODE=PostgreSQL;DB_CLOSE_DELAY=-1"
        })
class H2DefaultProfileSmokeTest {

    @Autowired
    private DataSource dataSource;

    @Autowired
    private Flyway flyway;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void defaultProfileMigratesAndValidatesOnH2() throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            assertThat(connection.getMetaData().getDatabaseProductName()).isEqualTo("H2");
        }
        assertThat(flyway.info().pending()).isEmpty();
        MigrationInfo current = flyway.info().current();
        assertThat(current).isNotNull();
        MigrationInfo[] all = flyway.info().all();
        assertThat(current.getVersion()).isEqualTo(all[all.length - 1].getVersion());
        // The default profile seeds demo data (db/seed), which the training run archives too.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM barbers", Integer.class))
                .isPositive();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM services WHERE active = TRUE", Integer.class))
                .isPositive();
    }
}
