package com.example.taskflow.migration;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import com.example.taskflow.testsupport.AppointmentDetailsFixtures;
import com.example.taskflow.notification.NotificationOutbox;
import com.example.taskflow.notification.NotificationOutboxWriter;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Real-engine (H2, PostgreSQL mode) tests of the data-integrity migrations: the dev/seed vs
 * production Flyway layout (DATA-2), V30 seed cleanup, V31 outbox backoff column, V32 catalog
 * integrity (DATA-6), V33 denial notices (DATA-10), V34 index cleanup (DATA-11), V26's slot
 * collision handling against the schema V25 really produces, and V35's end-time backfill and
 * overlap repair (plus, on PostgreSQL, its exclusion constraint).
 *
 * <p>The PostgreSQL-specific branches (the expression index in V32, the partial index in V25) are
 * exercised by the {@code DataMigrationsPostgresTest} subclass ({@code testcontainersTest}).
 */
abstract class AbstractDataMigrationsTest {

    private static final String DEV_MIGRATION = "classpath:db/migration";
    private static final String SEED = "classpath:db/seed";
    private static final String PROD_CLEANUP = "classpath:db/prod-cleanup";
    private static final String SENTINEL = "No Preference (First Available)";

    /** A JDBC URL of a brand-new, empty database (or schema) for one test. */
    protected abstract String newUrl() throws SQLException;

    protected abstract String user();

    protected abstract String password();

    protected abstract boolean isPostgres();

    /** Query returning one lower-case index name per row for every index of the database. */
    protected abstract String indexNamesSql();

    private FluentConfiguration flyway(String url, String... locations) {
        return Flyway.configure().dataSource(url, user(), password()).locations(locations);
    }

    /** Exactly what application-prod.properties configures. */
    private FluentConfiguration prodLike(String url) {
        return flyway(url, DEV_MIGRATION, SEED, PROD_CLEANUP).ignoreMigrationPatterns("*:future");
    }

    private static int count(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private static void exec(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            ps.execute();
        }
    }

    private Connection open(String url) throws SQLException {
        return DriverManager.getConnection(url, user(), password());
    }

    private static void insertAppointment(Connection c, String name, String email, String phone, String barber,
                                          String assignedBarber, String date, String time, String service,
                                          String status, String publicId) throws SQLException {
        exec(c, "INSERT INTO appointments (customer_name, customer_email, customer_phone, barber_name, barber_id, "
                + "booking_date, booking_time, service_type, status, public_id, created_at, updated_at) VALUES ("
                + "?, ?, ?, ?, (SELECT id FROM barbers WHERE name = ?), CAST(? AS DATE), CAST(? AS TIME), "
                + "?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                name, email, phone, barber, assignedBarber, date, time, service, status, publicId);
    }

    // ------------------------------------------------------------------ DATA-2 layout

    @Test
    void productionLikeLocationsCreateAFreshDatabaseWithoutDemoBookingsOrReviews() throws Exception {
        String url = newUrl();
        prodLike(url).load().migrate();

        try (Connection c = open(url)) {
            assertEquals(0, count(c, "SELECT COUNT(*) FROM appointments"), "no fake appointments in production");
            assertEquals(0, count(c, "SELECT COUNT(*) FROM reviews"), "no fake reviews in production");
            // reference data production needs is still there
            assertEquals(5, count(c, "SELECT COUNT(*) FROM services"));
            assertEquals(3, count(c, "SELECT COUNT(*) FROM barbers"));
            assertEquals(18, count(c, "SELECT COUNT(*) FROM barber_schedules"));
            // the seed migrations are resolvable (no blanket *:missing needed) and V30 removed their rows
            assertEquals(2, count(c, "SELECT COUNT(*) FROM \"flyway_schema_history\" WHERE \"version\" IN ('2', '11')"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM \"flyway_schema_history\" WHERE \"version\" = '30'"));
        }
        // the history validates against the very same configuration (what Flyway does on startup)
        prodLike(url).load().validate();
    }

    @Test
    void devAndTestLocationsStillCarryTheDemoData() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION, SEED).load().migrate();

        try (Connection c = open(url)) {
            assertTrue(count(c, "SELECT COUNT(*) FROM appointments") >= 16, "demo bookings are loaded in dev/test");
            assertEquals(8, count(c, "SELECT COUNT(*) FROM reviews"));
            assertEquals(0, count(c, "SELECT COUNT(*) FROM \"flyway_schema_history\" WHERE \"version\" = '30'"),
                    "the prod-only cleanup never runs in dev/test");
        }
    }

    @Test
    void everyMigrationAlsoWorksWithoutTheSeedMigrations() throws Exception {
        String url = newUrl();
        // would throw on any migration that silently needed V2/V11 rows (V3, V15, V22, V23, V26, ...)
        flyway(url, DEV_MIGRATION).load().migrate();
        flyway(url, DEV_MIGRATION).load().validate();
    }

    @Test
    void databaseThatAlreadyAppliedTheSeedsStillValidatesInProductionAndLosesThemInV30() throws Exception {
        String url = newUrl();
        // 1. the "old" production database: schema up to V26 WITH seed data
        flyway(url, DEV_MIGRATION, SEED).target("26").load().migrate();

        try (Connection c = open(url)) {
            int seeded = count(c, "SELECT COUNT(*) FROM appointments");
            assertTrue(seeded >= 16);
            assertEquals(8, count(c, "SELECT COUNT(*) FROM reviews"));

            // 2. real data created afterwards
            insertAppointment(c, "Real Customer", "real@customer.test", "555-9999", "Alex the Barber",
                    "Alex the Barber", "2031-05-05", "10:00",
                    "Classic Haircut", "APPROVED", "11111111-2222-3333-4444-555555555555");
            // a look-alike: seed e-mail but different phone and name must NOT be treated as seed data
            insertAppointment(c, "Other David", "david@example.com", "555-7777", "Sara the Stylist",
                    "Sara the Stylist", "2031-05-05", "11:00",
                    "Classic Haircut", "PENDING", "22222222-3333-4444-5555-666666666666");
            exec(c, "INSERT INTO reviews (appointment_id, rating, comment, created_at) VALUES "
                    + "((SELECT id FROM appointments WHERE public_id = '11111111-2222-3333-4444-555555555555'), "
                    + "5, 'real review', CURRENT_TIMESTAMP)");
            // undelivered mail to a seed address goes, delivered history and real mail stay
            exec(c, "INSERT INTO notification_outbox (recipient, type, message, sent_at, status) VALUES "
                    + "('keanu@example.com', 'EMAIL', 'm1', CURRENT_TIMESTAMP, 'PENDING'), "
                    + "('keanu@example.com', 'EMAIL', 'm2', CURRENT_TIMESTAMP, 'SENT'), "
                    + "('real@customer.test', 'EMAIL', 'm3', CURRENT_TIMESTAMP, 'PENDING')");
        }

        // 3. deploy the new image: same V2/V11 files (checksums match), plus V30
        prodLike(url).load().migrate();
        prodLike(url).load().validate();

        try (Connection c = open(url)) {
            assertEquals(2, count(c, "SELECT COUNT(*) FROM appointments"), "only the two non-seed rows remain");
            assertEquals(1, count(c, "SELECT COUNT(*) FROM appointments WHERE customer_name = 'Real Customer'"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM appointments WHERE customer_name = 'Other David'"));
            assertEquals(0, count(c, "SELECT COUNT(*) FROM appointments WHERE customer_email IN "
                    + "('keanu@example.com', 'brad@example.com', 'tom.cruise@example.com')"));
            assertEquals(0, count(c, "SELECT COUNT(*) FROM appointments WHERE public_id IN "
                    + "('f47ac10b-58cc-4372-a567-0e02b2c3d479', '6a8b0c1d-2e3f-4a5b-7c8d-9e0f1a2b3c4d')"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM reviews"), "only the real review is left");
            assertEquals(0, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'keanu@example.com' "
                    + "AND status <> 'SENT'"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'keanu@example.com' "
                    + "AND status = 'SENT'"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'real@customer.test'"));
        }
    }

    // ------------------------------------------------------------------ DATA-3 / V31

    @Test
    void v31AddsNullableNextAttemptColumnLeavingExistingRowsImmediatelyEligible() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).target("26").load().migrate();
        try (Connection c = open(url)) {
            exec(c, "INSERT INTO notification_outbox (recipient, type, message, sent_at, status) VALUES "
                    + "('a@b.c', 'EMAIL', 'm', CURRENT_TIMESTAMP, 'PENDING')");
        }

        flyway(url, DEV_MIGRATION).load().migrate();

        try (Connection c = open(url)) {
            assertEquals(1, count(c, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = CURRENT_SCHEMA AND UPPER(TABLE_NAME) = 'NOTIFICATION_OUTBOX' "
                    + "AND UPPER(COLUMN_NAME) = 'NEXT_ATTEMPT_AT' AND IS_NULLABLE = 'YES'"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE next_attempt_at IS NULL"));
        }
    }

    // ------------------------------------------------------------------ DATA-6 / V32

    @Test
    void v32CollapsesCaseInsensitiveDuplicateServicesAndEnforcesUniquenessAfterwards() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).target("31").load().migrate();
        try (Connection c = open(url)) {
            long keptId = singleLong(c, "SELECT id FROM services WHERE name = 'Classic Haircut'");
            exec(c, "INSERT INTO services (name, price, duration_minutes, category, description) VALUES "
                    + "('classic haircut', 99.00, 30, 'hair', 'dup lower'), "
                    + "('CLASSIC HAIRCUT', 98.00, 30, 'hair', 'dup upper'), "
                    + "('Unique One', 10.00, 15, 'hair', 'untouched')");
            long dupA = singleLong(c, "SELECT id FROM services WHERE name = 'classic haircut'");
            long dupB = singleLong(c, "SELECT id FROM services WHERE name = 'CLASSIC HAIRCUT'");
            insertAppointment(c, "A", "a@x.test", "1", "Alex the Barber", null, "2031-05-05", "09:00",
                    "classic haircut", "PENDING", "aaaaaaaa-0000-0000-0000-000000000001");
            insertAppointment(c, "B", "b@x.test", "1", "Alex the Barber", null, "2031-05-05", "10:00",
                    "CLASSIC HAIRCUT", "PENDING", "aaaaaaaa-0000-0000-0000-000000000002");
            exec(c, "UPDATE appointments SET service_id = ? WHERE customer_name = 'A'", dupA);
            exec(c, "UPDATE appointments SET service_id = ? WHERE customer_name = 'B'", dupB);

            flyway(url, DEV_MIGRATION).load().migrate();

            assertEquals(1, count(c, "SELECT COUNT(*) FROM services WHERE LOWER(name) = 'classic haircut'"),
                    "duplicates collapsed");
            assertEquals(keptId, singleLong(c, "SELECT id FROM services WHERE LOWER(name) = 'classic haircut'"),
                    "lowest id kept");
            assertEquals(2, count(c, "SELECT COUNT(*) FROM appointments WHERE service_id = ?", keptId),
                    "appointments re-pointed to the kept service");
            assertEquals(2, count(c, "SELECT COUNT(*) FROM appointments WHERE service_type = 'Classic Haircut'"),
                    "denormalised service name follows the kept row");
            assertEquals(1, count(c, "SELECT COUNT(*) FROM services WHERE name = 'Unique One'"));
            assertEquals(6, count(c, "SELECT COUNT(*) FROM services"));
            assertEquals(6, count(c, "SELECT COUNT(*) FROM services WHERE active = TRUE"), "active defaults to true");

            assertThrows(SQLException.class, () -> exec(c, "INSERT INTO services "
                    + "(name, price, duration_minutes, category) VALUES ('CLASSIC haircut', 1, 1, 'hair')"));
        }
    }

    @Test
    void v32DedupeKeepsAppointmentsWithoutServiceUntouched() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).target("31").load().migrate();
        try (Connection c = open(url)) {
            insertAppointment(c, "NoSvc", "n@x.test", "1", "Alex the Barber", null, "2031-05-05", "09:00",
                    "Legacy free text", "PENDING", "bbbbbbbb-0000-0000-0000-000000000001");
            flyway(url, DEV_MIGRATION).load().migrate();
            assertEquals("Legacy free text", singleString(c,
                    "SELECT service_type FROM appointments WHERE customer_name = 'NoSvc'"));
        }
    }

    // ------------------------------------------------------------------ DATA-10 / V33

    @Test
    void v33QueuesDeclinedNoticesForSilentlyDeniedSentinelBookings() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).target("32").load().migrate();
        LocalDate future = LocalDate.now().plusDays(30);
        LocalDate past = LocalDate.now().minusDays(30);
        try (Connection c = open(url)) {
            // what V26 leaves behind: DENIED, sentinel name, no barber
            insertAppointment(c, "Silent Sam", "sam@x.test", "1", SENTINEL, null, future.toString(), "09:30",
                    "Classic Haircut", "DENIED", "cccccccc-0000-0000-0000-000000000001");
            // already notified (an earlier DECLINED notice mentioning that date)
            insertAppointment(c, "Told Tina", "tina@x.test", "1", SENTINEL, null, future.toString(), "10:30",
                    "Classic Haircut", "DENIED", "cccccccc-0000-0000-0000-000000000002");
            exec(c, "INSERT INTO notification_outbox (recipient, type, message, sent_at, status) VALUES "
                    + "('tina@x.test', 'EMAIL', ?, CURRENT_TIMESTAMP, 'SENT')",
                    "Subject: Appointment DECLINED - on " + future + " ...");
            // a past slot: no apology
            insertAppointment(c, "Old Olga", "olga@x.test", "1", SENTINEL, null, past.toString(), "09:30",
                    "Classic Haircut", "DENIED", "cccccccc-0000-0000-0000-000000000003");
            // a normal admin denial of a real barber is not V26's doing
            insertAppointment(c, "Real Rita", "rita@x.test", "1", "Alex the Barber",
                    "Alex the Barber", future.toString(), "11:30",
                    "Classic Haircut", "DENIED", "cccccccc-0000-0000-0000-000000000004");
            // a sentinel booking that is still active is not denied
            insertAppointment(c, "Active Al", "al@x.test", "1", SENTINEL, null, future.toString(), "12:30",
                    "Classic Haircut", "PENDING", "cccccccc-0000-0000-0000-000000000005");
        }

        flyway(url, DEV_MIGRATION).load().migrate();

        try (Connection c = open(url)) {
            assertEquals(1, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'sam@x.test'"));
            assertEquals(0, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient IN "
                    + "('olga@x.test', 'rita@x.test', 'al@x.test')"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'tina@x.test'"),
                    "no duplicate notice");
            assertEquals("PENDING", singleString(c, "SELECT status FROM notification_outbox WHERE recipient = 'sam@x.test'"));
            assertEquals("EMAIL", singleString(c, "SELECT type FROM notification_outbox WHERE recipient = 'sam@x.test'"));
            assertEquals(0, count(c, "SELECT retry_count FROM notification_outbox WHERE recipient = 'sam@x.test'"));

            // identical wording to what the application writes for a DENIED status change
            Appointment appointment = new Appointment("Silent Sam", "sam@x.test", "1", SENTINEL, future, "09:30",
                    "Classic Haircut");
            appointment.setStatus("DENIED");
            NotificationOutboxRepository repository = Mockito.mock(NotificationOutboxRepository.class);
            new NotificationOutboxWriter(repository)
                    .handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, AppointmentDetailsFixtures.of(appointment)));
            ArgumentCaptor<NotificationOutbox> expected = ArgumentCaptor.forClass(NotificationOutbox.class);
            Mockito.verify(repository).save(expected.capture());
            assertEquals(expected.getValue().getMessage(),
                    singleString(c, "SELECT message FROM notification_outbox WHERE recipient = 'sam@x.test'"));
        }
    }

    // ------------------------------------------------------------------ DATA-11 / V34

    @Test
    void v34DropsTheUnusedIndexesAndKeepsTheUsedOnes() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).load().migrate();
        try (Connection c = open(url)) {
            List<String> indexes = new ArrayList<>();
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(indexNamesSql())) {
                while (rs.next()) {
                    indexes.add(rs.getString(1));
                }
            }
            assertFalse(indexes.contains("idx_reviews_rating_created"));
            assertFalse(indexes.contains("idx_appointments_service_type"));
            assertFalse(indexes.contains("idx_appointment_customer_name"));
            // still used by queries
            assertTrue(indexes.contains("idx_appointments_customer_email"));
            assertTrue(indexes.contains("idx_appointment_status_date"));
            assertTrue(indexes.contains("idx_appointments_booking_date"));
            assertTrue(indexes.contains("idx_appointments_service_id"));
            assertTrue(indexes.contains("idx_appointment_slot_active"));
        }
    }

    @Test
    void v36AddsTrigramSearchIndexesOnPostgresOnly() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).load().migrate();
        try (Connection c = open(url)) {
            List<String> indexes = new ArrayList<>();
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(indexNamesSql())) {
                while (rs.next()) {
                    indexes.add(rs.getString(1));
                }
            }
            for (String name : List.of("idx_appointments_name_trgm", "idx_appointments_email_trgm",
                    "idx_appointments_phone_trgm")) {
                assertEquals(isPostgres(), indexes.contains(name), name);
            }
        }
    }

    // ------------------------------------------------------------------ DATA-10: V26 against V25's index

    @Test
    void v26AssignsSentinelBookingsWithoutCollidingWithV25sActiveSlotIndex() throws Exception {
        String url = newUrl();
        // schema exactly as V25 leaves it: generated active_slot_marker + unique active-slot index
        flyway(url, DEV_MIGRATION).target("25").load().migrate();
        try (Connection c = open(url)) {
            if (!isPostgres()) {
                // H2 emulates the partial index with a generated marker column; PostgreSQL has a real one
                assertEquals(1, count(c, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                        + "WHERE TABLE_NAME = 'APPOINTMENTS' AND COLUMN_NAME = 'ACTIVE_SLOT_MARKER'"));
            }
            String monday = "2031-03-10";

            // Slot 10:00: Alex and Sara are busy -> the sentinel booking must go to Marcus.
            insertAppointment(c, "Alex busy", "a1@x.test", "1", "Alex the Barber",
                    "Alex the Barber", monday, "10:00",
                    "Classic Haircut", "APPROVED", "dddddddd-0000-0000-0000-000000000001");
            insertAppointment(c, "Sara busy", "s1@x.test", "1", "Sara the Stylist",
                    "Sara the Stylist", monday, "10:00",
                    "Classic Haircut", "PENDING", "dddddddd-0000-0000-0000-000000000002");
            insertAppointment(c, "Sentinel one", "n1@x.test", "1", SENTINEL, null, monday, "10:00",
                    "Classic Haircut", "PENDING", "dddddddd-0000-0000-0000-000000000003");

            // Slot 11:00: all three barbers busy -> the sentinel booking can only be denied.
            for (String barber : new String[] {"Alex the Barber", "Sara the Stylist", "Marcus Master Blade"}) {
                insertAppointment(c, barber + " 11", barber.substring(0, 2) + "@x.test", "1", barber,
                        barber, monday, "11:00",
                        "Classic Haircut", "APPROVED", "dddddddd-1111-0000-0000-0000000000" + barber.length());
            }
            insertAppointment(c, "Sentinel two", "n2@x.test", "1", SENTINEL, null, monday, "11:00",
                    "Classic Haircut", "PENDING", "dddddddd-0000-0000-0000-000000000004");

            // the index really guards this schema
            assertThrows(SQLException.class, () -> insertAppointment(c, "dup", "d@x.test", "1", "Alex the Barber",
                    null, monday, "10:00", "Classic Haircut", "PENDING", "dddddddd-0000-0000-0000-000000000009"));

            flyway(url, DEV_MIGRATION).target("26").load().migrate();

            assertEquals("Marcus Master Blade", singleString(c,
                    "SELECT barber_name FROM appointments WHERE customer_name = 'Sentinel one'"));
            assertEquals("PENDING", singleString(c,
                    "SELECT status FROM appointments WHERE customer_name = 'Sentinel one'"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM appointments WHERE customer_name = 'Sentinel one' "
                    + "AND barber_id IS NOT NULL"));
            assertEquals("DENIED", singleString(c,
                    "SELECT status FROM appointments WHERE customer_name = 'Sentinel two'"));
            assertEquals(SENTINEL, singleString(c,
                    "SELECT barber_name FROM appointments WHERE customer_name = 'Sentinel two'"));
        }
    }

    // ------------------------------------------------------------------ V35 end time + overlap constraint

    private static void linkService(Connection c, String customerName, String serviceName) throws SQLException {
        exec(c, "UPDATE appointments SET service_id = (SELECT id FROM services WHERE name = ?) "
                + "WHERE customer_name = ?", serviceName, customerName);
    }

    private static String endTimeOf(Connection c, String customerName) throws SQLException {
        return singleString(c, "SELECT booking_end_time FROM appointments WHERE customer_name = ?",
                customerName).substring(0, 8);
    }

    @Test
    void fixtureHelpersBindQuotedValuesAndNullableBarberReferences() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).target("34").load().migrate();
        String customer = "O'Connor";
        String service = "O'Brien's Cut";
        try (Connection c = open(url)) {
            exec(c, "INSERT INTO services (name, price, duration_minutes, category) VALUES (?, 25, 30, 'hair')",
                    service);
            insertAppointment(c, customer, "o'connor@x.test", "1'2", "Alex the Barber", "Alex the Barber",
                    "2031-05-05", "09:00", service, "PENDING", "eeeeeeee-1111-0000-0000-000000000001");
            insertAppointment(c, "' OR '1'='1", "literal@x.test", "1", "Alex the Barber", null,
                    "2031-05-05", "10:00", "Free text", "DENIED", "eeeeeeee-1111-0000-0000-000000000002");
            linkService(c, customer, service);

            assertEquals(1, count(c, "SELECT COUNT(*) FROM appointments WHERE customer_name = ? "
                    + "AND customer_email = ? AND customer_phone = ? AND barber_id IS NOT NULL AND service_id IS NOT NULL",
                    customer, "o'connor@x.test", "1'2"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM appointments WHERE customer_name = ? AND barber_id IS NULL",
                    "' OR '1'='1"));
            assertEquals("PENDING", statusOf(c, customer));
            assertEquals("DENIED", statusOf(c, "' OR '1'='1"));

            flyway(url, DEV_MIGRATION).load().migrate();
            assertEquals("09:30:00", endTimeOf(c, customer));
            assertEquals("11:00:00", endTimeOf(c, "' OR '1'='1"));
        }
    }

    @Test
    void v35BackfillsTheEndTimeFromTheServiceDurationAndClampsBeforeMidnight() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).target("34").load().migrate();
        String date = LocalDate.now().plusDays(30).toString();
        try (Connection c = open(url)) {
            insertAppointment(c, "Exec", "e@x.test", "1", "Alex the Barber", null, date, "09:00",
                    "The Executive Package", "PENDING", "eeeeeeee-0000-0000-0000-000000000001");
            linkService(c, "Exec", "The Executive Package");                                  // 60 min
            insertAppointment(c, "Fade", "f@x.test", "1", "Alex the Barber", null, date, "13:00",
                    "Modern Skin Fade", "DENIED", "eeeeeeee-0000-0000-0000-000000000002");
            linkService(c, "Fade", "Modern Skin Fade");                                       // 45 min, any status
            insertAppointment(c, "Legacy", "l@x.test", "1", "Sara the Stylist", null, date, "10:00",
                    "Free text", "APPROVED", "eeeeeeee-0000-0000-0000-000000000003");         // no service
            insertAppointment(c, "Late", "late@x.test", "1", "Sara the Stylist", null, date, "23:30",
                    "Free text", "PENDING", "eeeeeeee-0000-0000-0000-000000000004");          // would wrap
        }

        flyway(url, DEV_MIGRATION).load().migrate();

        try (Connection c = open(url)) {
            assertEquals("10:00:00", endTimeOf(c, "Exec"));
            assertEquals("13:45:00", endTimeOf(c, "Fade"));
            assertEquals("11:00:00", endTimeOf(c, "Legacy"), "no service = one 60-minute grid step");
            assertEquals("23:59:59", endTimeOf(c, "Late"), "clamped, never wrapped to the next morning");
            assertEquals(0, count(c, "SELECT COUNT(*) FROM appointments WHERE booking_end_time IS NULL"));
            assertEquals("APPROVED", singleString(c, "SELECT status FROM appointments WHERE customer_name = 'Legacy'"),
                    "non-overlapping rows keep their status");

            // NOT NULL and end >= start from now on
            assertThrows(SQLException.class, () -> insertAppointment(c, "NoEnd", "n@x.test", "1",
                    "Marcus Master Blade", null, date, "09:00", "Free text", "PENDING",
                    "eeeeeeee-0000-0000-0000-000000000005"));
            assertThrows(SQLException.class, () -> exec(c, "UPDATE appointments SET booking_end_time = TIME '08:00' "
                    + "WHERE customer_name = 'Exec'"));
        }
    }

    @Test
    void v35DeniesOverlappingActiveBookingsDeterministicallyAndTellsUpcomingCustomers() throws Exception {
        String url = newUrl();
        flyway(url, DEV_MIGRATION).target("34").load().migrate();
        String future = LocalDate.now().plusDays(30).toString();
        String past = LocalDate.now().minusDays(30).toString();
        String alex = "Alex the Barber";
        try (Connection c = open(url)) {
            exec(c, "INSERT INTO services (name, price, duration_minutes, category, description) VALUES "
                    + "('Long Treatment', 50.00, 90, 'hair', 'ninety minutes')");
            // 10:00-11:30 PENDING (lower id) vs 11:00-11:30 APPROVED: the APPROVED booking wins
            insertAppointment(c, "Long Pending", "lp@x.test", "1", "Alex the Barber", alex, future, "10:00",
                    "Long Treatment", "PENDING", "ffffffff-0000-0000-0000-000000000001");
            linkService(c, "Long Pending", "Long Treatment");
            insertAppointment(c, "Short Approved", "sa@x.test", "1", "Alex the Barber", alex, future, "11:00",
                    "Classic Haircut", "APPROVED", "ffffffff-0000-0000-0000-000000000002");
            linkService(c, "Short Approved", "Classic Haircut");
            // 13:00-14:30 PENDING vs 14:00-14:30 PENDING: the earlier booking (lower id) wins
            insertAppointment(c, "First Pending", "fp@x.test", "1", "Alex the Barber", alex, future, "13:00",
                    "Long Treatment", "PENDING", "ffffffff-0000-0000-0000-000000000003");
            linkService(c, "First Pending", "Long Treatment");
            insertAppointment(c, "Second Pending", "sp@x.test", "1", "Alex the Barber", alex, future, "14:00",
                    "Classic Haircut", "PENDING", "ffffffff-0000-0000-0000-000000000004");
            linkService(c, "Second Pending", "Classic Haircut");
            // back to back with the kept 13:00-14:30 booking: no overlap, stays
            insertAppointment(c, "Back To Back", "bb@x.test", "1", "Alex the Barber", alex, future, "15:00",
                    "Classic Haircut", "PENDING", "ffffffff-0000-0000-0000-000000000005");
            linkService(c, "Back To Back", "Classic Haircut");
            // cancelled rows and other barbers never conflict
            insertAppointment(c, "Cancelled", "cx@x.test", "1", "Alex the Barber", alex, future, "16:00",
                    "Classic Haircut", "CANCELLED", "ffffffff-0000-0000-0000-000000000006");
            insertAppointment(c, "Sara Same Time", "ss@x.test", "1", "Sara the Stylist",
                    "Sara the Stylist", future, "10:00",
                    "Classic Haircut", "PENDING", "ffffffff-0000-0000-0000-000000000007");
            // a past overlap is repaired too, but nobody is e-mailed about a slot long gone
            insertAppointment(c, "Past Long", "pl@x.test", "1", "Alex the Barber", alex, past, "10:00",
                    "Long Treatment", "APPROVED", "ffffffff-0000-0000-0000-000000000008");
            linkService(c, "Past Long", "Long Treatment");
            insertAppointment(c, "Past Short", "ps@x.test", "1", "Alex the Barber", alex, past, "11:00",
                    "Classic Haircut", "APPROVED", "ffffffff-0000-0000-0000-000000000009");
        }

        flyway(url, DEV_MIGRATION).load().migrate();

        try (Connection c = open(url)) {
            assertEquals("DENIED", statusOf(c, "Long Pending"));
            assertEquals("APPROVED", statusOf(c, "Short Approved"));
            assertEquals("PENDING", statusOf(c, "First Pending"));
            assertEquals("DENIED", statusOf(c, "Second Pending"));
            assertEquals("PENDING", statusOf(c, "Back To Back"));
            assertEquals("CANCELLED", statusOf(c, "Cancelled"));
            assertEquals("PENDING", statusOf(c, "Sara Same Time"));
            assertEquals("APPROVED", statusOf(c, "Past Long"));
            assertEquals("DENIED", statusOf(c, "Past Short"));

            assertEquals(1, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'lp@x.test' "
                    + "AND status = 'PENDING'"));
            assertEquals(1, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'sp@x.test'"));
            assertEquals(0, count(c, "SELECT COUNT(*) FROM notification_outbox WHERE recipient = 'ps@x.test'"));
            assertEquals(2, count(c, "SELECT COUNT(*) FROM notification_outbox"));

            // identical wording to what the application writes for a DENIED status change
            Appointment appointment = new Appointment("Long Pending", "lp@x.test", "1", "Alex the Barber",
                    LocalDate.parse(future), "10:00", "Long Treatment");
            appointment.setStatus("DENIED");
            NotificationOutboxRepository repository = Mockito.mock(NotificationOutboxRepository.class);
            new NotificationOutboxWriter(repository)
                    .handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, AppointmentDetailsFixtures.of(appointment)));
            ArgumentCaptor<NotificationOutbox> expected = ArgumentCaptor.forClass(NotificationOutbox.class);
            Mockito.verify(repository).save(expected.capture());
            assertEquals(expected.getValue().getMessage(),
                    singleString(c, "SELECT message FROM notification_outbox WHERE recipient = 'lp@x.test'"));

            if (isPostgres()) {
                assertEquals(1, count(c, "SELECT COUNT(*) FROM pg_constraint WHERE conname = 'appointments_no_overlap' "
                        + "AND contype = 'x' AND conrelid = 'appointments'::regclass"));
                // a different start time that overlaps the kept 13:00-14:30 booking is refused by the database
                SQLException ex = assertThrows(SQLException.class, () -> exec(c,
                        "INSERT INTO appointments (customer_name, customer_email, customer_phone, barber_name, "
                                + "booking_date, booking_time, booking_end_time, service_type, status, public_id, "
                                + "created_at, updated_at) VALUES ('Racer', 'r@x.test', '1', 'Alex the Barber', "
                                + "CAST(? AS DATE), TIME '14:00', TIME '15:00', 'Cut', 'PENDING', "
                                + "'ffffffff-0000-0000-0000-00000000000a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", future));
                assertEquals("23P01", ex.getSQLState());
            }
        }
    }

    private static String statusOf(Connection c, String customerName) throws SQLException {
        return singleString(c, "SELECT status FROM appointments WHERE customer_name = ?", customerName);
    }

    private static long singleLong(Connection c, String sql) throws SQLException {
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            assertTrue(rs.next());
            return rs.getLong(1);
        }
    }

    private static String singleString(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                return rs.getString(1);
            }
        }
    }

    @Test
    void productionLayoutStillFailsFastWhenAnAppliedMigrationDisappears() throws Exception {
        String url = newUrl();
        prodLike(url).load().migrate();
        try (Connection c = open(url)) {
            // simulate an applied migration whose file was deleted/renamed in a later image
            exec(c, "INSERT INTO \"flyway_schema_history\" (\"installed_rank\", \"version\", \"description\", \"type\", "
                    + "\"script\", \"checksum\", \"installed_by\", \"execution_time\", \"success\") VALUES "
                    + "(999, '29', 'vanished', 'SQL', 'V29__vanished.sql', 1, 'test', 0, TRUE)");
        }
        assertThrows(org.flywaydb.core.api.exception.FlywayValidateException.class,
                () -> prodLike(url).load().validate(),
                "a missing applied migration must not pass validation silently in production");
    }
}
