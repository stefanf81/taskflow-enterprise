package com.example.taskflow;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.stats.cache.ttl=0"})
class TaskflowApplicationTest {

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void contextLoads() {
        assertNotNull(applicationContext, "ApplicationContext should load successfully");
        assertTrue(applicationContext.containsBean("taskflowApplication"), "TaskflowApplication bean should be in context");
    }

    @Test
    void testMain() {
        assertDoesNotThrow(() -> TaskflowApplication.main(new String[]{"--server.port=0"}),
                "Main application method should execute without throwing exceptions");
    }

    @Test
    void flywayDiscoversPublicIdRepairAndUsesTimeColumnOnH2() {
        assertEquals(1, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM \"flyway_schema_history\" WHERE \"version\" = '23'", Integer.class));
        assertEquals("TIME", jdbcTemplate.queryForObject("""
                SELECT DATA_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'APPOINTMENTS' AND COLUMN_NAME = 'BOOKING_TIME'
                """, String.class));
    }
}
