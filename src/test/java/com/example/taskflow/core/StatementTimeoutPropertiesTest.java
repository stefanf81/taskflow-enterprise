package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import org.springframework.boot.convert.DurationStyle;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every database access path in production has a statement timeout, and they agree. JPA queries had
 * one; the refresh-session checks run through {@code JdbcTemplate}, which the JPA setting does not
 * reach, and waited up to the 30-second socket timeout (BENCHMARKS.md §76).
 */
class StatementTimeoutPropertiesTest {

    @Test
    void jdbcTemplateQueriesHaveTheSameTimeoutAsJpaQueries() throws IOException {
        Properties prod = new Properties();
        try (InputStream in = getClass().getResourceAsStream("/application-prod.properties")) {
            prod.load(in);
        }

        Duration jpa = Duration.ofMillis(Long.parseLong(
                prod.getProperty("spring.jpa.properties.jakarta.persistence.query.timeout")));
        String jdbc = prod.getProperty("spring.jdbc.template.query-timeout");

        assertThat(jdbc).as("spring.jdbc.template.query-timeout").isNotNull();
        assertThat(DurationStyle.detectAndParse(jdbc)).isEqualTo(jpa);
        // Below the mobile client's 10-second request deadline.
        assertThat(jpa).isLessThan(Duration.ofSeconds(10));
    }
}
