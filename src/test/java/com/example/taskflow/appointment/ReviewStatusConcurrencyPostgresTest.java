package com.example.taskflow.appointment;

import com.example.taskflow.testsupport.PostgresTestServer;
import org.junit.jupiter.api.Tag;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.sql.DriverManager;
import java.sql.SQLException;

@Tag("testcontainers")
class ReviewStatusConcurrencyPostgresTest extends ReviewStatusConcurrencyIntegrationTest {
    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) throws SQLException {
        String base = PostgresTestServer.jdbcUrl();
        String schema = "review_race_" + System.nanoTime();
        try (var connection = DriverManager.getConnection(base, PostgresTestServer.user(), PostgresTestServer.password());
             var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA " + schema);
        }
        registry.add("spring.datasource.url", () -> base + (base.contains("?") ? "&" : "?") + "currentSchema=" + schema);
        registry.add("spring.datasource.username", PostgresTestServer::user);
        registry.add("spring.datasource.password", PostgresTestServer::password);
        registry.add("spring.datasource.driverClassName", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
    }
}
