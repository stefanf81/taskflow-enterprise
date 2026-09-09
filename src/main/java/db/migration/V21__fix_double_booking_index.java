package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Set;

public class V21__fix_double_booking_index extends BaseJavaMigration {

    private static final DateTimeFormatter LEGACY_TIME_FORMAT = DateTimeFormatter.ofPattern("H:mm");
    private static final DateTimeFormatter CANONICAL_TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");
    private static final Set<String> VALID_STATUSES = Set.of("PENDING", "APPROVED", "DENIED");
    private static final String LEGACY_TIME_PATTERN = "(?:[01]?\\d|2[0-3]):[0-5]\\d";

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        String dbName = connection.getMetaData().getDatabaseProductName();

        try (Statement statement = connection.createStatement()) {
            sanitizeLegacyAppointments(connection);

            // Keep the earliest approved row. If no approved row exists, keep the
            // earliest pending row. This handles both approved/pending conflicts
            // and multiple pending rows before the unique index is created.
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'PENDING' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND a2.booking_time = a.booking_time "
                    + "AND a2.status = 'APPROVED')");
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'APPROVED' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.id < a.id AND a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND a2.booking_time = a.booking_time "
                    + "AND a2.status = 'APPROVED')");
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'PENDING' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.id < a.id AND a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND a2.booking_time = a.booking_time "
                    + "AND a2.status = 'PENDING')");

            statement.execute("DROP INDEX IF EXISTS idx_appointment_slot");
            statement.execute("DROP INDEX IF EXISTS idx_appointment_slot_active");

            if ("PostgreSQL".equalsIgnoreCase(dbName)) {
                statement.execute("CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING', 'APPROVED')");
            } else {
                // H2 does not use PostgreSQL's partial-index syntax consistently
                // across supported modes. A generated marker column gives it the
                // same semantics: active rows share marker 1, denied rows share
                // NULL and therefore remain repeatable. The column is generated,
                // so status changes automatically update the indexed value.
                statement.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS active_slot_marker INTEGER AS (CASE WHEN status IN ('PENDING', 'APPROVED') THEN 1 ELSE NULL END)");
                statement.execute("CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time, active_slot_marker)");
            }
        }
    }

    private static void sanitizeLegacyAppointments(Connection connection) throws Exception {
        try (Statement select = connection.createStatement();
             ResultSet rows = select.executeQuery("SELECT id, booking_time, status FROM appointments");
             PreparedStatement update = connection.prepareStatement(
                     "UPDATE appointments SET booking_time = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")) {
            while (rows.next()) {
                long id = rows.getLong("id");
                String bookingTime = rows.getString("booking_time");
                String status = rows.getString("status");
                String normalizedTime = normalizeTime(bookingTime);
                String normalizedStatus = VALID_STATUSES.contains(status) ? status : "DENIED";

                // Invalid active slots cannot safely participate in uniqueness
                // checks. Preserve the appointment for audit, but deny it.
                if (normalizedTime == null) {
                    normalizedTime = "00:00";
                    if ("PENDING".equals(normalizedStatus) || "APPROVED".equals(normalizedStatus)) {
                        normalizedStatus = "DENIED";
                    }
                }

                if (!normalizedTime.equals(bookingTime) || !normalizedStatus.equals(status)) {
                    update.setString(1, normalizedTime);
                    update.setString(2, normalizedStatus);
                    update.setLong(3, id);
                    update.addBatch();
                }
            }
            update.executeBatch();
        }
    }

    private static String normalizeTime(String value) {
        if (value == null || !value.matches(LEGACY_TIME_PATTERN)) {
            return null;
        }
        try {
            return LocalTime.parse(value, LEGACY_TIME_FORMAT).format(CANONICAL_TIME_FORMAT);
        } catch (DateTimeParseException ex) {
            return null;
        }
    }
}
