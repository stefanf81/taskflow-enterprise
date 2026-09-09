package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Statement;

/**
 * Brings databases that applied the original V21 and databases created from the
 * corrected migration sequence to the same active-slot uniqueness semantics.
 */
public class V25__converge_appointment_slot_index extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        String dbName = context.getConnection().getMetaData().getDatabaseProductName();

        try (Statement statement = context.getConnection().createStatement()) {
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'PENDING' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND a2.booking_time = a.booking_time AND a2.status = 'APPROVED')");
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'PENDING' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.id < a.id AND a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND a2.booking_time = a.booking_time AND a2.status = 'PENDING')");
            statement.execute("UPDATE appointments a SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP "
                    + "WHERE a.status = 'APPROVED' AND EXISTS (SELECT 1 FROM appointments a2 "
                    + "WHERE a2.id < a.id AND a2.barber_name = a.barber_name AND a2.booking_date = a.booking_date "
                    + "AND a2.booking_time = a.booking_time AND a2.status = 'APPROVED')");

            statement.execute("DROP INDEX IF EXISTS idx_appointment_slot_active");
            if ("PostgreSQL".equalsIgnoreCase(dbName)) {
                statement.execute("CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING', 'APPROVED')");
            } else {
                statement.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS active_slot_marker INTEGER AS (CASE WHEN status IN ('PENDING', 'APPROVED') THEN 1 ELSE NULL END)");
                statement.execute("CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time, active_slot_marker)");
            }
        }
    }
}
