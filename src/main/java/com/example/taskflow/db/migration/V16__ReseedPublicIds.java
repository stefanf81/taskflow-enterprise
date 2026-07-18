package com.example.taskflow.db.migration;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/**
 * C1 (security): rewrite enumerable {@code public_id} values previously assigned
 * to seed and backfilled appointment rows with cryptographically-random UUIDs.
 *
 * V3 originally set 'seed-uuid-1'..'seed-uuid-4' and 'temp-uuid-' || id for
 * backfill rows. Those values are trivially guessable and let an attacker
 * enumerate appointment resources.
 *
 * Implemented as a Java migration (rather than SQL) so it is fully portable
 * across H2 (dev/test) and PostgreSQL (prod / Testcontainers): it uses
 * {@link UUID#randomUUID()} from the JVM instead of a database-specific UUID
 * function (H2's {@code RANDOM_UUID()} vs PostgreSQL's {@code gen_random_uuid()}
 * would otherwise force two DB-specific scripts).
 */
public class V16__ReseedPublicIds extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        try (Statement stmt = context.getConnection().createStatement()) {

            // 1. The 4 legacy seed appointments (fixed weak placeholders).
            String[] seedIds = {"seed-uuid-1", "seed-uuid-2", "seed-uuid-3", "seed-uuid-4"};
            try (PreparedStatement ps = context.getConnection().prepareStatement(
                    "UPDATE appointments SET public_id = ? WHERE public_id = ?")) {
                for (String weak : seedIds) {
                    ps.setString(1, UUID.randomUUID().toString());
                    ps.setString(2, weak);
                    ps.addBatch();
                }
                ps.executeBatch();
            }

            // 2. Any backfilled rows that used the 'temp-uuid-<id>' pattern.
            //    H2 uses LIKE; PostgreSQL also supports LIKE — portable.
            try (PreparedStatement ps = context.getConnection().prepareStatement(
                    "UPDATE appointments SET public_id = ? WHERE public_id LIKE 'temp-uuid-%'")) {
                ps.setString(1, UUID.randomUUID().toString());
                ps.executeUpdate();
            }

            // 3. Defensive: any remaining non-UUID public_id (NULL or not 36-char hex-dash).
            try (ResultSet rs = stmt.executeQuery(
                    "SELECT id, public_id FROM appointments WHERE public_id IS NULL OR length(public_id) <> 36")) {
                try (PreparedStatement ps = context.getConnection().prepareStatement(
                        "UPDATE appointments SET public_id = ? WHERE id = ?")) {
                    while (rs.next()) {
                        ps.setString(1, UUID.randomUUID().toString());
                        ps.setLong(2, rs.getLong("id"));
                        ps.addBatch();
                    }
                    ps.executeBatch();
                }
            }
        }
    }
}
