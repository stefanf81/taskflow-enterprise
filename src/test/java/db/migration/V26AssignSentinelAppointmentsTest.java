package db.migration;

import org.flywaydb.core.api.configuration.Configuration;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.Date;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Time;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifies the V26 sentinel backfill against a real SQL engine (H2 in
 * PostgreSQL compatibility mode). The migration must assign each legacy
 * "No Preference" booking to a distinct available barber and deny any row no
 * barber can serve, without creating a slot-uniqueness collision.
 */
class V26AssignSentinelAppointmentsTest {

    private static final String SENTINEL = "No Preference (First Available)";
    private static final LocalDate MONDAY = LocalDate.of(2026, 9, 14);

    private Connection newDatabase() throws SQLException {
        Connection connection = DriverManager.getConnection(
                "jdbc:h2:mem:v26-" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
        try (Statement st = connection.createStatement()) {
            st.execute("CREATE TABLE barbers (id BIGINT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE)");
            st.execute("CREATE TABLE barber_schedules (id BIGINT PRIMARY KEY, barber_id BIGINT NOT NULL, "
                    + "day_of_week INTEGER NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL)");
            st.execute("CREATE TABLE barber_time_off (id BIGINT PRIMARY KEY, barber_id BIGINT NOT NULL, "
                    + "start_date DATE NOT NULL, end_date DATE NOT NULL)");
            st.execute("CREATE TABLE appointments (id BIGINT PRIMARY KEY, barber_id BIGINT, "
                    + "barber_name VARCHAR(100) NOT NULL, booking_date DATE NOT NULL, booking_time TIME NOT NULL, "
                    + "status VARCHAR(50) NOT NULL, updated_at TIMESTAMP)");
        }
        return connection;
    }

    private void insertBarber(Connection connection, long id, String name) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement("INSERT INTO barbers (id, name) VALUES (?, ?)")) {
            ps.setLong(1, id);
            ps.setString(2, name);
            ps.executeUpdate();
        }
    }

    private void insertSchedule(Connection connection, long id, long barberId) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO barber_schedules (id, barber_id, day_of_week, start_time, end_time) VALUES (?, ?, 1, '09:00:00', '17:00:00')")) {
            ps.setLong(1, id);
            ps.setLong(2, barberId);
            ps.executeUpdate();
        }
    }

    private void insertTimeOff(Connection connection, long id, long barberId) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO barber_time_off (id, barber_id, start_date, end_date) VALUES (?, ?, ?, ?)")) {
            ps.setLong(1, id);
            ps.setLong(2, barberId);
            ps.setDate(3, Date.valueOf(MONDAY));
            ps.setDate(4, Date.valueOf(MONDAY));
            ps.executeUpdate();
        }
    }

    private void insertSentinelAppointment(Connection connection, long id, String time) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO appointments (id, barber_id, barber_name, booking_date, booking_time, status, updated_at) "
                        + "VALUES (?, NULL, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)")) {
            ps.setLong(1, id);
            ps.setString(2, SENTINEL);
            ps.setDate(3, Date.valueOf(MONDAY));
            ps.setTime(4, Time.valueOf(time));
            ps.executeUpdate();
        }
    }

    private void insertConfirmedAppointment(Connection connection, long id, String barberName, String time) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO appointments (id, barber_id, barber_name, booking_date, booking_time, status, updated_at) "
                        + "VALUES (?, NULL, ?, ?, ?, 'APPROVED', CURRENT_TIMESTAMP)")) {
            ps.setLong(1, id);
            ps.setString(2, barberName);
            ps.setDate(3, Date.valueOf(MONDAY));
            ps.setTime(4, Time.valueOf(time));
            ps.executeUpdate();
        }
    }

    private void runMigration(Connection connection) throws Exception {
        new V26__assign_sentinel_appointments().migrate(new Context() {
            @Override
            public Configuration getConfiguration() {
                return null;
            }

            @Override
            public Connection getConnection() {
                return connection;
            }
        });
    }

    private record AppointmentState(String barberName, Long barberId, String status) {
    }

    private AppointmentState state(Connection connection, long id) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT barber_name, barber_id, status FROM appointments WHERE id = ?")) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                long barberId = rs.getLong("barber_id");
                boolean barberIdWasNull = rs.wasNull();
                return new AppointmentState(
                        rs.getString("barber_name"),
                        barberIdWasNull ? null : barberId,
                        rs.getString("status"));
            }
        }
    }

    @Test
    void assignsDistinctBarbersAndDeniesOverflow() throws Exception {
        try (Connection connection = newDatabase()) {
            insertBarber(connection, 1, "Alex");
            insertBarber(connection, 2, "Sara");
            insertBarber(connection, 3, "Marcus");
            insertSchedule(connection, 1, 1);
            insertSchedule(connection, 2, 2);
            insertSchedule(connection, 3, 3);

            // Four active sentinel bookings at the same slot; only three barbers exist.
            insertSentinelAppointment(connection, 1, "10:00:00");
            insertSentinelAppointment(connection, 2, "10:00:00");
            insertSentinelAppointment(connection, 3, "10:00:00");
            insertSentinelAppointment(connection, 4, "10:00:00");

            runMigration(connection);

            Set<String> assigned = new HashSet<>();
            int denied = 0;
            for (long id = 1; id <= 4; id++) {
                AppointmentState state = state(connection, id);
                if ("DENIED".equals(state.status())) {
                    denied++;
                } else {
                    assertTrue(state.barberId() != null, "assigned row must carry a barber FK");
                    assigned.add(state.barberName());
                }
            }
            assertEquals(3, assigned.size(), "each available barber accepts exactly one booking");
            assertEquals(1, denied, "the overflow booking is denied");
        }
    }

    @Test
    void deniesWhenNoBarberCanServe() throws Exception {
        try (Connection connection = newDatabase()) {
            insertBarber(connection, 1, "Alex");
            insertBarber(connection, 2, "Sara");
            insertSchedule(connection, 1, 1);
            // Sara has a schedule but is on time off; Alex is free.
            insertSchedule(connection, 2, 2);
            insertTimeOff(connection, 1, 2);

            // A slot outside every working window cannot be served by anyone.
            insertSentinelAppointment(connection, 1, "18:00:00");
            // 10:00 is covered by Alex even though Sara is off.
            insertSentinelAppointment(connection, 2, "10:00:00");

            runMigration(connection);

            AppointmentState unservable = state(connection, 1);
            assertEquals("DENIED", unservable.status());
            assertNull(unservable.barberId());

            AppointmentState serviceable = state(connection, 2);
            assertEquals("Alex", serviceable.barberName());
            assertEquals(1L, serviceable.barberId());
        }
    }

    @Test
    void skipsBarberAlreadyBookedAtSlot() throws Exception {
        try (Connection connection = newDatabase()) {
            insertBarber(connection, 1, "Alex");
            insertBarber(connection, 2, "Sara");
            insertSchedule(connection, 1, 1);
            insertSchedule(connection, 2, 2);
            insertConfirmedAppointment(connection, 99, "Alex", "10:00:00");

            insertSentinelAppointment(connection, 1, "10:00:00");

            runMigration(connection);

            AppointmentState assigned = state(connection, 1);
            assertEquals("Sara", assigned.barberName());
            assertEquals(2L, assigned.barberId());
        }
    }

    @Test
    void isIdempotentWhenNoSentinelRowsRemain() throws Exception {
        try (Connection connection = newDatabase()) {
            insertBarber(connection, 1, "Alex");
            insertSchedule(connection, 1, 1);
            insertSentinelAppointment(connection, 1, "10:00:00");

            runMigration(connection);
            AppointmentState first = state(connection, 1);

            // Re-running after the repair must not reassign or corrupt anything.
            runMigration(connection);
            AppointmentState second = state(connection, 1);

            assertEquals(first.barberName(), second.barberName());
            assertEquals(first.barberId(), second.barberId());
            assertEquals("PENDING", second.status());
        }
    }
}
