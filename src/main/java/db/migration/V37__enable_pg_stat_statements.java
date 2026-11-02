package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.sql.Statement;

/**
 * Installs the database-local SQL objects needed by the PostgreSQL exporter's stat_statements
 * collector. Preloading the library alone does not create its functions or views.
 *
 * <p>PostgreSQL only; H2 has no equivalent. The server must separately preload
 * {@code pg_stat_statements} via {@code shared_preload_libraries} (and restart after changing it).
 * Installing this extension requires a privileged migration role. As with V36, optional monitoring
 * must not block application startup on servers without the extension or the required privileges:
 * warn and leave installation to a DBA. Flyway will not retry an already recorded migration.
 */
public class V37__enable_pg_stat_statements extends BaseJavaMigration {

    private static final Logger log = LoggerFactory.getLogger(V37__enable_pg_stat_statements.class);

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        if (!"PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName())) {
            return;
        }
        Savepoint beforeExtension = connection.setSavepoint();
        try (Statement statement = connection.createStatement()) {
            statement.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public");
        } catch (SQLException e) {
            // PostgreSQL aborts the transaction on an error; restore it for Flyway's history update.
            connection.rollback(beforeExtension);
            log.warn("V37: pg_stat_statements could not be installed ({}). Query-performance metrics "
                    + "remain unavailable. A DBA must run CREATE EXTENSION IF NOT EXISTS "
                    + "pg_stat_statements WITH SCHEMA public in this database and ensure the server "
                    + "preloads pg_stat_statements; Flyway will not retry this migration.", e.getMessage());
        } finally {
            connection.releaseSavepoint(beforeExtension);
        }
    }
}
