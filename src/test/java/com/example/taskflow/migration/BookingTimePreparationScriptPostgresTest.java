package com.example.taskflow.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * DATA-8: runs {@code scripts/prepare-booking-time-migration.sh} (needs {@code bash} and {@code psql})
 * against a real PostgreSQL database holding legacy data in the V20 schema, then lets Flyway apply
 * V21..latest on top. Before the fix, merging {@code 9:00} into {@code 09:00} could leave two active
 * rows on one slot (V21's {@code CREATE UNIQUE INDEX} then failed) or violate the legacy 4-column
 * index mid-script.
 *
 * <p>Skipped unless {@code TASKFLOW_TEST_POSTGRES_URL} (e.g. {@code jdbc:postgresql://127.0.0.1:5432/postgres})
 * is set; a throw-away database is created and dropped per test. See {@link DataMigrationsPostgresTest}.
 */
@EnabledIfEnvironmentVariable(named = "TASKFLOW_TEST_POSTGRES_URL", matches = ".+")
class BookingTimePreparationScriptPostgresTest {

    private static final String MONDAY = "2031-03-10";
    private static final String TUESDAY = "2031-03-11";
    private static final String WEDNESDAY = "2031-03-12";

    private final URI adminUri = URI.create(System.getenv("TASKFLOW_TEST_POSTGRES_URL").substring("jdbc:".length()));
    private final String user = System.getenv().getOrDefault("TASKFLOW_TEST_POSTGRES_USER", "postgres");
    private final String password = System.getenv().getOrDefault("TASKFLOW_TEST_POSTGRES_PASSWORD", "");

    private String jdbcUrl(String database) {
        return "jdbc:postgresql://" + adminUri.getHost() + ":" + adminUri.getPort() + "/" + database;
    }

    private Connection connect(String database) throws SQLException {
        return DriverManager.getConnection(jdbcUrl(database), user, password);
    }

    private static void exec(Connection c, String sql) throws SQLException {
        try (Statement st = c.createStatement()) {
            st.execute(sql);
        }
    }

    private static void legacyRow(Connection c, String name, String barber, String date, String time, String status)
            throws SQLException {
        // V1 schema: booking_time is VARCHAR; the legacy unique index also contains status
        exec(c, "INSERT INTO appointments (customer_name, customer_email, customer_phone, barber_name, "
                + "booking_date, booking_time, service_type, status, public_id, created_at, updated_at) VALUES ('"
                + name + "', '" + name.replace(' ', '.') + "@x.test', '1', '" + barber + "', DATE '" + date + "', '"
                + time + "', 'Classic Haircut', '" + status + "', '" + java.util.UUID.randomUUID()
                + "', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
    }

    private Map<String, String> statuses(Connection c) throws SQLException {
        Map<String, String> result = new LinkedHashMap<>();
        try (Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("SELECT customer_name, status FROM appointments ORDER BY id")) {
            while (rs.next()) {
                result.put(rs.getString(1), rs.getString(2));
            }
        }
        return result;
    }

    private Map<String, String> times(Connection c) throws SQLException {
        Map<String, String> result = new LinkedHashMap<>();
        try (Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("SELECT customer_name, booking_time::text FROM appointments ORDER BY id")) {
            while (rs.next()) {
                result.put(rs.getString(1), rs.getString(2));
            }
        }
        return result;
    }

    private int runScript(String database, String mode) throws Exception {
        ProcessBuilder pb = new ProcessBuilder("bash", "scripts/prepare-booking-time-migration.sh", mode);
        pb.environment().put("PGHOST", adminUri.getHost());
        pb.environment().put("PGPORT", String.valueOf(adminUri.getPort()));
        pb.environment().put("PGDATABASE", database);
        pb.environment().put("PGUSER", user);
        pb.environment().put("PGPASSWORD", password.isEmpty() ? "unused" : password);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        System.out.println("[prepare-booking-time-migration " + mode + "] exit=" + exit + "\n" + output);
        return exit;
    }

    private void withLegacyDatabase(ThrowingConsumer<String> body) throws Exception {
        String database = "bt_" + System.nanoTime();
        try (Connection admin = connect(adminUri.getPath().substring(1)); Statement st = admin.createStatement()) {
            st.execute("CREATE DATABASE " + database);
        }
        try {
            // exactly the schema production has before V21: V1..V20 (no seed data)
            Flyway.configure().dataSource(jdbcUrl(database), user, password)
                    .locations("classpath:db/migration").target("20").load().migrate();
            body.accept(database);
        } finally {
            try (Connection admin = connect(adminUri.getPath().substring(1)); Statement st = admin.createStatement()) {
                st.execute("DROP DATABASE IF EXISTS " + database + " WITH (FORCE)");
            }
        }
    }

    private interface ThrowingConsumer<T> {
        void accept(T value) throws Exception;
    }

    @Test
    void applyResolvesCollisionsSoThatV21AndLaterMigrationsSucceed() throws Exception {
        withLegacyDatabase(database -> {
            try (Connection c = connect(database)) {
                // 9:00 and 09:00 PENDING for the same slot -> must collapse to the earliest
                legacyRow(c, "p1", "Alex the Barber", MONDAY, "9:00", "PENDING");
                legacyRow(c, "p2", "Alex the Barber", MONDAY, "09:00", "PENDING");
                // two APPROVED rows that canonicalise to one slot
                legacyRow(c, "a1", "Alex the Barber", MONDAY, "9:30", "APPROVED");
                legacyRow(c, "a2", "Alex the Barber", MONDAY, "09:30", "APPROVED");
                // PENDING (older) and APPROVED (newer) on the same slot: the approved booking wins
                legacyRow(c, "mixP", "Alex the Barber", MONDAY, "10:00", "PENDING");
                legacyRow(c, "mixA", "Alex the Barber", MONDAY, "10:00", "APPROVED");
                // two DENIED rows that canonicalise to one slot (the legacy index would reject the UPDATE)
                legacyRow(c, "d1", "Alex the Barber", TUESDAY, "9:00", "DENIED");
                legacyRow(c, "d2", "Alex the Barber", TUESDAY, "09:00", "DENIED");
                // malformed times of the same barber/day both become 00:00/DENIED
                legacyRow(c, "bad1", "Alex the Barber", WEDNESDAY, "tbd", "PENDING");
                legacyRow(c, "bad2", "Alex the Barber", WEDNESDAY, "later", "PENDING");
                // an unknown legacy status and an untouched healthy row
                legacyRow(c, "odd", "Sara the Stylist", MONDAY, "11:00", "CANCELLED");
                legacyRow(c, "ok", "Sara the Stylist", MONDAY, "14:15", "PENDING");
            }

            assertEquals(0, runScript(database, "--apply"));

            try (Connection c = connect(database)) {
                Map<String, String> status = statuses(c);
                assertEquals("PENDING", status.get("p1"));
                assertEquals("DENIED", status.get("p2"));
                assertEquals("APPROVED", status.get("a1"));
                assertEquals("DENIED", status.get("a2"));
                assertEquals("DENIED", status.get("mixP"));
                assertEquals("APPROVED", status.get("mixA"));
                assertEquals("DENIED", status.get("d1"));
                assertEquals("DENIED", status.get("d2"));
                assertEquals("DENIED", status.get("bad1"));
                assertEquals("DENIED", status.get("bad2"));
                assertEquals("DENIED", status.get("odd"));
                assertEquals("PENDING", status.get("ok"));
                Map<String, String> time = times(c);
                assertEquals("09:00", time.get("p1"));
                assertEquals("09:00", time.get("p2"));
                assertEquals("00:00", time.get("bad1"));
            }

            // the real thing: V21 creates its unique index, V22 converts to TIME, V25/V26 run ...
            Flyway.configure().dataSource(jdbcUrl(database), user, password)
                    .locations("classpath:db/migration").load().migrate();

            try (Connection c = connect(database)) {
                assertEquals("PENDING", statuses(c).get("p1"));
                assertEquals("APPROVED", statuses(c).get("mixA"));
                assertThrows(SQLException.class, () -> legacyRowAfterV22(c));
            }
        });
    }

    private static void legacyRowAfterV22(Connection c) throws SQLException {
        exec(c, "INSERT INTO appointments (customer_name, customer_email, customer_phone, barber_name, "
                + "booking_date, booking_time, service_type, status, public_id, created_at, updated_at) VALUES "
                + "('dup', 'dup@x.test', '1', 'Alex the Barber', DATE '" + MONDAY + "', TIME '09:00', 'Cut', "
                + "'PENDING', 'f0f0f0f0-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
    }

    @Test
    void dryRunReportsCollisionsAndChangesNothing() throws Exception {
        withLegacyDatabase(database -> {
            try (Connection c = connect(database)) {
                legacyRow(c, "p1", "Alex the Barber", MONDAY, "9:00", "PENDING");
                legacyRow(c, "p2", "Alex the Barber", MONDAY, "09:00", "PENDING");
            }

            assertEquals(0, runScript(database, "--dry-run"));

            try (Connection c = connect(database)) {
                assertEquals("PENDING", statuses(c).get("p2"));
                assertEquals("9:00", times(c).get("p1"));
            }
        });
    }
}
