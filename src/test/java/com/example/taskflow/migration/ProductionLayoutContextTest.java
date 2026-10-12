package com.example.taskflow.migration;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Boots the whole application on a fresh H2 database migrated with exactly the Flyway layout of
 * {@code application-prod.properties} ({@code db/seed} plus {@code db/prod-cleanup}, whose V30 deletes the seed rows). The
 * context only starts if Hibernate's {@code ddl-auto=validate} accepts the migrated schema, so this
 * covers "schema validates without V2/V11", and the database must come up with no demo data.
 */
@SpringBootTest(properties = {
        "app.rate-limit.enabled=false",
        "app.schedulers.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:prodlayout;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.flyway.locations=classpath:db/migration,classpath:db/seed,classpath:db/prod-cleanup",
        "spring.flyway.ignore-migration-patterns=*:future",
        "spring.jpa.hibernate.ddl-auto=validate"
})
class ProductionLayoutContextTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void freshProductionLayoutDatabaseHasReferenceDataButNoDemoBookings() {
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM appointments", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM reviews", Integer.class));
        assertEquals(5, jdbc.queryForObject("SELECT COUNT(*) FROM services WHERE active = TRUE", Integer.class));
        assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM barbers", Integer.class));
    }
}
