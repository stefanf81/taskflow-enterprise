package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.Statement;

public class V21__fix_double_booking_index extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        String dbName = connection.getMetaData().getDatabaseProductName();

        try (Statement statement = connection.createStatement()) {
            // Normalize the legacy four-character form before comparing slots.
            // V22 later converts the column to TIME, but V21 must work while the
            // column is still VARCHAR on a fresh database.
            statement.execute("UPDATE appointments SET booking_time = LPAD(booking_time, 5, '0') WHERE LENGTH(booking_time) = 4 AND booking_time LIKE '_:%'");

            // Keep the earliest approved row. If no approved row exists, keep the
            // earliest pending row. This handles both approved/pending conflicts
            // and multiple pending rows before the unique index is created.
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'PENDING' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND CAST(a2.booking_time AS TIME) = CAST(a.booking_time AS TIME) "
                    + "AND a2.status = 'APPROVED')");
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'APPROVED' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.id < a.id AND a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND CAST(a2.booking_time AS TIME) = CAST(a.booking_time AS TIME) "
                    + "AND a2.status = 'APPROVED')");
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'PENDING' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.id < a.id AND a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND CAST(a2.booking_time AS TIME) = CAST(a.booking_time AS TIME) "
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
}
