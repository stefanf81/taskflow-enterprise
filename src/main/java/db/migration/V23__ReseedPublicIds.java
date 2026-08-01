package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;

/**
 * Forward-only replacement for the previously undiscovered V16 migration.
 * Keeping the repair at the current migration frontier avoids introducing an
 * out-of-order version into databases that already applied V17-V22. The
 * migration is intentionally idempotent and handles both fresh and existing
 * databases containing enumerable seed or temporary identifiers.
 */
public class V23__ReseedPublicIds extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        try (Statement statement = context.getConnection().createStatement();
             ResultSet rows = statement.executeQuery(
                     "SELECT id FROM appointments WHERE public_id IS NULL "
                             + "OR LENGTH(public_id) <> 36 "
                             + "OR public_id LIKE 'seed-uuid-%' "
                             + "OR public_id LIKE 'temp-uuid-%'")) {
            try (PreparedStatement update = context.getConnection().prepareStatement(
                    "UPDATE appointments SET public_id = ? WHERE id = ?")) {
                while (rows.next()) {
                    update.setString(1, UUID.randomUUID().toString());
                    update.setLong(2, rows.getLong("id"));
                    update.addBatch();
                }
                update.executeBatch();
            }
        }
    }
}
