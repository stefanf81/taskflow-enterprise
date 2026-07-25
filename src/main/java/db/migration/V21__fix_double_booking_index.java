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
            statement.execute("UPDATE appointments SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP WHERE status = 'PENDING' AND EXISTS (SELECT 1 FROM appointments a2 WHERE a2.barber_name = appointments.barber_name AND a2.booking_date = appointments.booking_date AND a2.booking_time = appointments.booking_time AND a2.status = 'APPROVED')");

            statement.execute("DROP INDEX IF EXISTS idx_appointment_slot");

            if ("PostgreSQL".equalsIgnoreCase(dbName)) {
                statement.execute("CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING', 'APPROVED')");
            } else {
                statement.execute("CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time, status)");
            }
        }
    }
}
