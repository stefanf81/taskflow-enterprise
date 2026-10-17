package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.sql.Statement;

/**
 * Trigram indexes for the admin search.
 *
 * <p>The admin search matches {@code lower(customer_name|customer_email|customer_phone) LIKE '%term%'}
 * (or the exact public id). A leading wildcard can use no B-tree index, so every search was two
 * sequential scans (rows and count): about 54 ms each at 180k appointments. GIN trigram indexes on
 * the same {@code lower(...)} expressions serve those predicates, including the {@code LIKE ? ESCAPE ?}
 * form Hibernate sends: a selective term took 3.7 ms. Terms shorter than three characters, and terms
 * matching a large part of the table, still scan.
 *
 * <p><b>PostgreSQL only.</b> H2 has no expression indexes; the search works there without them.
 * {@code pg_trgm} ships with the PostgreSQL contrib package (in the official {@code postgres} images)
 * and is a trusted extension since PostgreSQL 13, so the database owner can create it. Unlike V35's
 * constraint these indexes are only an optimisation: if the extension cannot be created the migration
 * logs a warning and leaves the search unindexed instead of failing startup. A DBA can then run
 * {@code CREATE EXTENSION pg_trgm;} and create the indexes below by hand.
 *
 * <p>The indexes are built inside the migration transaction, which blocks writes to
 * {@code appointments} while they build (about two seconds for 180k rows).
 */
public class V36__admin_search_trigram_indexes extends BaseJavaMigration {

    private static final Logger log = LoggerFactory.getLogger(V36__admin_search_trigram_indexes.class);

    /** Index name and the column whose {@code lower()} it covers. */
    static final String[][] INDEXES = {
        {"idx_appointments_name_trgm", "customer_name"},
        {"idx_appointments_email_trgm", "customer_email"},
        {"idx_appointments_phone_trgm", "customer_phone"},
    };

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        if (!"PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName())) {
            return;
        }
        // A failed statement aborts the whole PostgreSQL transaction; the savepoint keeps the
        // migration (and Flyway's history update) usable when the extension is unavailable.
        Savepoint beforeExtension = connection.setSavepoint();
        try (Statement statement = connection.createStatement()) {
            statement.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        } catch (SQLException e) {
            connection.rollback(beforeExtension);
            log.warn("V36: the PostgreSQL extension pg_trgm could not be created ({}); the admin search "
                    + "stays unindexed. Run CREATE EXTENSION pg_trgm; and the CREATE INDEX statements of "
                    + "V36 to add the indexes later.", e.getMessage());
            return;
        }
        // The operator class is named explicitly, so it must be qualified with the schema the
        // extension lives in: an extension exists once per database, and when it was installed in
        // a schema outside this connection's search_path, an unqualified gin_trgm_ops is not found.
        String opclass = quoteIdentifier(extensionSchema(connection)) + ".gin_trgm_ops";
        try (Statement statement = connection.createStatement()) {
            for (String[] index : INDEXES) {
                statement.execute("CREATE INDEX IF NOT EXISTS " + index[0]
                        + " ON appointments USING gin (lower(" + index[1] + ") " + opclass + ")");
            }
        }
    }

    private static String extensionSchema(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery("SELECT n.nspname FROM pg_extension e "
                     + "JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'")) {
            if (!rs.next()) {
                throw new IllegalStateException("pg_trgm was created but is not listed in pg_extension");
            }
            return rs.getString(1);
        }
    }

    private static String quoteIdentifier(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }
}
