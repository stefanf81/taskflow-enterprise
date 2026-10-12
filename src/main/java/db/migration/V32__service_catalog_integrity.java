package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.Statement;

/**
 * DATA-6: catalog integrity.
 *
 * <ol>
 *   <li><b>Retire instead of delete.</b> Adds {@code services.active BOOLEAN NOT NULL DEFAULT TRUE}.
 *       A service that appointments reference can no longer be hard-deleted (fk_appointment_service
 *       is ON DELETE RESTRICT, so it surfaced as a 500); the application now deactivates it instead.</li>
 *   <li><b>Unique service names, case-insensitively.</b> {@code services.name} had no uniqueness at
 *       all, so two "Classic Haircut" rows made booking resolve a name ambiguously. Existing duplicates
 *       (compared with {@code LOWER(name)}) are collapsed first: the LOWEST id is kept, appointments
 *       that referenced a removed duplicate are re-pointed to the kept row (both {@code service_id}
 *       and the denormalised {@code service_type} name) and the duplicates are deleted. A unique
 *       index is then created.</li>
 * </ol>
 *
 * <p>Dialect handling (same approach as V21/V25): PostgreSQL gets a real expression index
 * {@code UNIQUE (LOWER(name))}; H2 (dev/test) has no portable expression indexes, so it gets a
 * generated column {@code name_key AS LOWER(name)} with a unique index on it, which has the same
 * semantics. Hibernate never writes the generated column and {@code ddl-auto=validate} ignores
 * extra columns.
 */
public class V32__service_catalog_integrity extends BaseJavaMigration {

    static final String UNIQUE_INDEX = "uq_services_name_lower";

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        String dbName = connection.getMetaData().getDatabaseProductName();

        try (Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE services ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE");

            // 1. Re-point appointments of a removed duplicate at the kept (lowest-id) service.
            statement.execute("UPDATE appointments SET "
                    + "service_id = (SELECT MIN(k.id) FROM services k WHERE LOWER(k.name) = "
                    + "(SELECT LOWER(d.name) FROM services d WHERE d.id = appointments.service_id)), "
                    + "service_type = (SELECT k.name FROM services k WHERE k.id = "
                    + "(SELECT MIN(k2.id) FROM services k2 WHERE LOWER(k2.name) = "
                    + "(SELECT LOWER(d2.name) FROM services d2 WHERE d2.id = appointments.service_id))) "
                    + "WHERE service_id IN (SELECT d3.id FROM services d3 WHERE EXISTS "
                    + "(SELECT 1 FROM services k3 WHERE LOWER(k3.name) = LOWER(d3.name) AND k3.id < d3.id))");

            // 2. Remove the duplicates.
            statement.execute("DELETE FROM services WHERE EXISTS "
                    + "(SELECT 1 FROM services k WHERE LOWER(k.name) = LOWER(services.name) AND k.id < services.id)");

            // 3. Enforce uniqueness from now on.
            statement.execute("DROP INDEX IF EXISTS " + UNIQUE_INDEX);
            if ("PostgreSQL".equalsIgnoreCase(dbName)) {
                statement.execute("CREATE UNIQUE INDEX " + UNIQUE_INDEX + " ON services (LOWER(name))");
            } else {
                statement.execute("ALTER TABLE services ADD COLUMN IF NOT EXISTS name_key VARCHAR(100) "
                        + "AS (LOWER(name))");
                statement.execute("CREATE UNIQUE INDEX " + UNIQUE_INDEX + " ON services (name_key)");
            }
        }
    }
}
