package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HexFormat;
import java.util.Locale;

/** Freeze old creation payloads before the first reschedule; portable across H2 and PostgreSQL. */
public class V41__freeze_appointment_creation_request extends BaseJavaMigration {

    /** Rows per JDBC batch and per fetch: bounded memory however large the table is. */
    private static final int CHUNK = 500;

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        try (Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE appointments ADD COLUMN creation_request_fingerprint VARCHAR(64)");
        }
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        try (Statement select = connection.createStatement();
             PreparedStatement update = connection.prepareStatement(
                     "UPDATE appointments SET creation_request_fingerprint = ? WHERE id = ?")) {
            // Flyway runs the migration in a transaction, so PostgreSQL streams with a cursor.
            select.setFetchSize(CHUNK);
            try (ResultSet rows = select.executeQuery("SELECT id, customer_email, barber_name, booking_date, "
                    + "booking_time, service_type FROM appointments")) {
                int pending = 0;
                while (rows.next()) {
                    String time = rows.getTime("booking_time").toLocalTime().toString();
                    if (time.length() > 5) {
                        time = time.substring(0, 5);
                    }
                    // Versioned, self-contained copy: a future application refactor must not change
                    // the meaning of an already-released Flyway migration.
                    StringBuilder canonical = new StringBuilder("v1|");
                    String[] values = {
                            rows.getString("customer_email").trim().toLowerCase(Locale.ROOT),
                            rows.getString("barber_name").trim(),
                            rows.getDate("booking_date").toLocalDate().toString(), time,
                            rows.getString("service_type").trim()};
                    for (String value : values) {
                        canonical.append(value.length()).append(':').append(value);
                    }
                    update.setString(1, HexFormat.of().formatHex(
                            sha256.digest(canonical.toString().getBytes(StandardCharsets.UTF_8))));
                    update.setLong(2, rows.getLong("id"));
                    update.addBatch();
                    if (++pending == CHUNK) {
                        update.executeBatch();
                        pending = 0;
                    }
                }
                if (pending > 0) {
                    update.executeBatch();
                }
            }
        }
    }
}
