package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Prepares the schema for soft cancellation and optimistic locking.
 *
 * <ol>
 *   <li>{@code appointments.version} backs the JPA {@code @Version} field, so a concurrent
 *       approve/deny/cancel cannot silently interleave.</li>
 *   <li>The status CHECK constraint accepts the new {@code CANCELLED} status. A cancelled
 *       row is kept (history, reviews, idempotency replays) but does not occupy a slot:
 *       the active-slot index from V21/V25 only covers {@code PENDING}/{@code APPROVED},
 *       on PostgreSQL through the partial-index predicate and on H2 through the
 *       generated {@code active_slot_marker} column, which is NULL for any other status.</li>
 *   <li>{@code reviews.appointment_id} no longer cascades: appointments are never hard
 *       deleted by the application any more, and a stray delete must not silently erase
 *       customer reviews. The FK name is auto-generated and differs between PostgreSQL
 *       and H2, so it is discovered from the JDBC metadata.</li>
 * </ol>
 */
public class V27__soft_cancel_and_optimistic_lock extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();

        try (Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0");

            statement.execute("ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_appointment_status");
            statement.execute("ALTER TABLE appointments ADD CONSTRAINT chk_appointment_status "
                    + "CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED'))");
        }

        Set<String> existingForeignKeys = findAppointmentForeignKeys(connection);
        try (Statement statement = connection.createStatement()) {
            for (String name : existingForeignKeys) {
                statement.execute("ALTER TABLE reviews DROP CONSTRAINT " + quoteIdentifier(name));
            }
            statement.execute("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS fk_review_appointment");
            statement.execute("ALTER TABLE reviews ADD CONSTRAINT fk_review_appointment "
                    + "FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT");
        }
    }

    /** Names of every FK on {@code reviews.appointment_id}, whatever the engine called them. */
    private static Set<String> findAppointmentForeignKeys(Connection connection) throws SQLException {
        DatabaseMetaData metaData = connection.getMetaData();
        Set<String> names = new LinkedHashSet<>();
        // PostgreSQL folds unquoted identifiers to lower case, H2 to upper case.
        for (String table : new String[] {"reviews", "REVIEWS"}) {
            try (ResultSet rs = metaData.getImportedKeys(connection.getCatalog(), connection.getSchema(), table)) {
                while (rs.next()) {
                    String column = rs.getString("FKCOLUMN_NAME");
                    String name = rs.getString("FK_NAME");
                    if (name != null && column != null && "appointment_id".equalsIgnoreCase(column)) {
                        names.add(name);
                    }
                }
            }
        }
        return names;
    }

    private static String quoteIdentifier(String name) {
        return "\"" + name.replace("\"", "\"\"") + "\"";
    }
}
