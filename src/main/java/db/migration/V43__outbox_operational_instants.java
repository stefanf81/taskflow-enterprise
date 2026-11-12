package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.Statement;
import java.util.Locale;

/**
 * Convert {@code notification_outbox.claimed_at} and {@code next_attempt_at} from wall-clock
 * {@code TIMESTAMP} to {@code TIMESTAMP WITH TIME ZONE} so outbox claim leases and retry backoffs
 * measure elapsed instants rather than shop-local wall-clock time across DST transitions.
 *
 * <p>{@code sent_at} remains {@code TIMESTAMP} so the admin API contract ({@code NotificationOutboxResponse})
 * is unchanged. Pre-existing non-null operational timestamps had no stored zone offset; they are
 * converted under the database session time zone and clamped to {@code now} (claims) and
 * {@code now + 1 hour} (the {@code OutboxBackoff.MAX_DELAY} ceiling) so a shop/database zone mismatch
 * cannot strand an in-flight claim or retry for hours.
 */
public class V43__outbox_operational_instants extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        boolean postgres = connection.getMetaData().getDatabaseProductName()
                .toLowerCase(Locale.ROOT).contains("postgres");

        try (Statement statement = connection.createStatement()) {
            statement.execute("DROP INDEX IF EXISTS idx_outbox_claim");
            if (postgres) {
                statement.execute("ALTER TABLE notification_outbox "
                        + "ALTER COLUMN claimed_at TYPE TIMESTAMP WITH TIME ZONE "
                        + "USING claimed_at AT TIME ZONE CURRENT_SETTING('TIMEZONE'), "
                        + "ALTER COLUMN next_attempt_at TYPE TIMESTAMP WITH TIME ZONE "
                        + "USING next_attempt_at AT TIME ZONE CURRENT_SETTING('TIMEZONE')");
                statement.execute("UPDATE notification_outbox SET claimed_at = CURRENT_TIMESTAMP "
                        + "WHERE claimed_at IS NOT NULL AND claimed_at > CURRENT_TIMESTAMP");
                statement.execute("UPDATE notification_outbox "
                        + "SET next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '1 hour' "
                        + "WHERE next_attempt_at IS NOT NULL "
                        + "AND next_attempt_at > CURRENT_TIMESTAMP + INTERVAL '1 hour'");
            } else {
                statement.execute("ALTER TABLE notification_outbox "
                        + "ALTER COLUMN claimed_at SET DATA TYPE TIMESTAMP WITH TIME ZONE");
                statement.execute("ALTER TABLE notification_outbox "
                        + "ALTER COLUMN next_attempt_at SET DATA TYPE TIMESTAMP WITH TIME ZONE");
                statement.execute("UPDATE notification_outbox SET claimed_at = CURRENT_TIMESTAMP "
                        + "WHERE claimed_at IS NOT NULL AND claimed_at > CURRENT_TIMESTAMP");
                statement.execute("UPDATE notification_outbox "
                        + "SET next_attempt_at = DATEADD('HOUR', 1, CURRENT_TIMESTAMP) "
                        + "WHERE next_attempt_at IS NOT NULL "
                        + "AND next_attempt_at > DATEADD('HOUR', 1, CURRENT_TIMESTAMP)");
            }
            statement.execute("CREATE INDEX idx_outbox_claim ON notification_outbox (status, claimed_at)");
        }
    }
}
