package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Statement;

/**
 * Price snapshot and case-insensitive e-mail lookups.
 *
 * <ul>
 *   <li>{@code appointments.price_at_booking} freezes the service price when the booking is
 *       made, so editing a catalog price no longer rewrites historical revenue. Legacy rows
 *       are backfilled from the service they reference; rows without a service stay NULL and
 *       revenue falls back to the live price ({@code COALESCE}).</li>
 *   <li>Customer e-mails are matched with {@code lower(col) = lower(:email)}. PostgreSQL gets
 *       functional indexes for those lookups. H2 has no expression indexes, so the indexes
 *       are created on PostgreSQL only; the lookup still works on H2, just without the index.</li>
 * </ul>
 */
public class V28__price_snapshot_and_email_indexes extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        String dbName = context.getConnection().getMetaData().getDatabaseProductName();

        try (Statement statement = context.getConnection().createStatement()) {
            statement.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS price_at_booking NUMERIC(10, 2)");
            statement.execute("UPDATE appointments SET price_at_booking = "
                    + "(SELECT s.price FROM services s WHERE s.id = appointments.service_id) "
                    + "WHERE price_at_booking IS NULL AND service_id IS NOT NULL");

            if ("PostgreSQL".equalsIgnoreCase(dbName)) {
                statement.execute("CREATE INDEX IF NOT EXISTS idx_appointments_customer_email_lower "
                        + "ON appointments (lower(customer_email))");
                statement.execute("CREATE INDEX IF NOT EXISTS idx_app_users_email_lower "
                        + "ON app_users (lower(email))");
            }
        }
    }
}
