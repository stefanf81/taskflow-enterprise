package com.example.taskflow;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.stats.cache.ttl=0"})
class TaskflowApplicationTest {

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void contextLoads() {
        assertNotNull(applicationContext, "ApplicationContext should load successfully");
        assertTrue(
                applicationContext.containsBean("taskflowApplication"),
                "TaskflowApplication bean should be in context");
    }

    @Test
    void testMain() {
        assertDoesNotThrow(
                () -> TaskflowApplication.main(new String[] {"--server.port=0"}),
                "Main application method should execute without throwing exceptions");
    }

    @Test
    void flywayDiscoversPublicIdRepairAndUsesTimeColumn() {
        assertEquals(
                1,
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM flyway_schema_history WHERE version = '23'", Integer.class));
        // PostgreSQL reports "time without time zone"; H2 (H2DefaultProfileSmokeTest's engine) "TIME".
        String type = jdbcTemplate.queryForObject("""
                SELECT data_type
                FROM information_schema.columns
                WHERE LOWER(table_name) = 'appointments' AND LOWER(column_name) = 'booking_time'
                """, String.class);
        assertTrue(type.toLowerCase(java.util.Locale.ROOT).startsWith("time"), type);
    }
}
