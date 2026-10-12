package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Stored appointment end time and, on PostgreSQL, a database-enforced "no overlapping bookings"
 * rule (closes the residual race of services longer than the 60-minute grid step).
 *
 * <p>Until now the overlap rule lived only in the booking transaction; the database guarded just
 * the exact start time (partial unique index {@code idx_appointment_slot_active}, V21/V25). Two
 * concurrent bookings with different, overlapping intervals - a 90-minute service at 10:00 and a
 * booking at 11:00 - could both commit.
 *
 * <ol>
 *   <li><b>{@code appointments.booking_end_time TIME}</b>, backfilled as {@code booking_time} +
 *       the duration of the row's service ({@code service_id}); 60 minutes (one grid step, the rule
 *       the application already applied) when the row has no service or the service has no positive
 *       duration. The service's <em>current</em> duration is the only information available, so a
 *       service whose duration was edited before this migration backfills with the new length.
 *       From now on the end time is a snapshot taken at booking time, like {@code price_at_booking}.
 *       <br>End past midnight: bookings must end by the barber's closing time, so a wrap can only
 *       come from a corrupt legacy row; the end is clamped to {@code 23:59:59} (never before the
 *       start) instead of wrapping to the next morning. The application clamps the same way
 *       ({@code Appointment.endTimeOf}). A row whose start is already {@code 23:59:59} gets an empty
 *       interval, which overlaps nothing.</li>
 *   <li><b>Repair of existing overlaps.</b> The constraint below cannot be created while active
 *       rows overlap, so PENDING/APPROVED rows are walked per barber and date - APPROVED before
 *       PENDING, then lowest id (the earliest booking) first, the same precedence V25 used for
 *       duplicate start times - and every row overlapping an already kept one is set to
 *       {@code DENIED}. The affected ids are logged. Customers of denied bookings dated today or
 *       later get the same "Appointment DECLINED" e-mail the application writes for a denial
 *       (a PENDING outbox row; V33 had to repair V26 for skipping this). Runs on both engines.</li>
 *   <li>{@code booking_end_time} becomes NOT NULL and a CHECK {@code booking_end_time >=
 *       booking_time} is added (both engines).</li>
 *   <li><b>PostgreSQL only:</b> {@code CREATE EXTENSION IF NOT EXISTS btree_gist} (needed for the
 *       {@code barber_name WITH =} part of a GiST index) and
 *       <pre>
 *   ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
 *       barber_name WITH =,
 *       tsrange(booking_date + booking_time, booking_date + booking_end_time) WITH &amp;&amp;)
 *   WHERE (status IN ('PENDING', 'APPROVED'))
 *       </pre>
 *       {@code tsrange} defaults to {@code [start, end)}, exactly the application's half-open
 *       interval: back-to-back bookings do not conflict. The barber is keyed by {@code barber_name},
 *       like {@code idx_appointment_slot_active} and every availability query: it is NOT NULL,
 *       unique in {@code barbers} and never renamed, whereas {@code barber_id} is NULL on legacy rows
 *       (EXCLUDE treats NULLs as distinct, so those rows would escape the constraint). A violating
 *       insert/update fails with SQLSTATE {@code 23P01} (exclusion_violation), which the application
 *       maps like the unique-index race ({@code 23505}).
 *       <br>Privileges: btree_gist ships with the PostgreSQL contrib package (included in the
 *       official {@code postgres} images used by docker-compose, CI and Testcontainers) and is a
 *       trusted extension since PostgreSQL 13, so a non-superuser owner with {@code CREATE} on the
 *       database can install it; otherwise a DBA runs {@code CREATE EXTENSION btree_gist;} once
 *       beforehand. If it cannot be created the migration fails loudly (and rolls back) rather than
 *       silently skipping the constraint.</li>
 * </ol>
 *
 * <p><b>H2 (dev/test)</b> has no exclusion constraints: it gets the column, the backfill, the repair
 * and the CHECK, and the in-transaction rule check ({@code BusySlotsService}) stays the only guard
 * against overlapping intervals with different start times there.
 */
public class V35__appointment_end_time_and_overlap_constraint extends BaseJavaMigration {

    private static final Logger log = LoggerFactory.getLogger(V35__appointment_end_time_and_overlap_constraint.class);

    static final String EXCLUSION_CONSTRAINT = "appointments_no_overlap";
    static final String END_CHECK = "chk_appointment_end_after_start";

    /** Same as {@code Appointment.DEFAULT_DURATION_MINUTES}; duplicated so this migration never changes. */
    static final int DEFAULT_DURATION_MINUTES = 60;
    static final LocalTime LATEST_END_TIME = LocalTime.of(23, 59, 59);

    private static final String SELECT_MISSING_END =
            "SELECT a.id, a.booking_time, s.duration_minutes FROM appointments a "
                    + "LEFT JOIN services s ON s.id = a.service_id WHERE a.booking_end_time IS NULL";

    private static final String SET_END = "UPDATE appointments SET booking_end_time = ? WHERE id = ?";

    private static final String SELECT_ACTIVE =
            "SELECT id, barber_name, booking_date, booking_time, booking_end_time, status, customer_email, "
                    + "customer_name, service_type, CASE WHEN booking_date >= CURRENT_DATE THEN 1 ELSE 0 END AS upcoming "
                    + "FROM appointments WHERE status IN ('PENDING', 'APPROVED') "
                    + "ORDER BY barber_name, booking_date, CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END, id";

    private static final String DENY =
            "UPDATE appointments SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP WHERE id = ?";

    private static final String NOTIFY =
            "INSERT INTO notification_outbox (recipient, type, message, sent_at, status, retry_count) "
                    + "VALUES (?, 'EMAIL', ?, CURRENT_TIMESTAMP, 'PENDING', 0)";

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        boolean postgres = "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName());

        try (Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_end_time TIME");
        }
        backfillEndTimes(connection);
        denyOverlappingBookings(connection);
        try (Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE appointments ALTER COLUMN booking_end_time SET NOT NULL");
            statement.execute("ALTER TABLE appointments DROP CONSTRAINT IF EXISTS " + END_CHECK);
            statement.execute("ALTER TABLE appointments ADD CONSTRAINT " + END_CHECK
                    + " CHECK (booking_end_time >= booking_time)");
        }
        if (postgres) {
            addExclusionConstraint(connection);
        }
    }

    /** End of an interval starting at {@code start}: start + duration, clamped to 23:59:59, never before start. */
    static LocalTime endTimeOf(LocalTime start, int durationMinutes) {
        long endSecond = start.toSecondOfDay() + durationMinutes * 60L;
        if (endSecond > LATEST_END_TIME.toSecondOfDay()) {
            return start.isAfter(LATEST_END_TIME) ? start : LATEST_END_TIME;
        }
        return start.plusMinutes(durationMinutes);
    }

    private static void backfillEndTimes(Connection connection) throws SQLException {
        int updated = 0;
        try (PreparedStatement select = connection.prepareStatement(SELECT_MISSING_END);
             PreparedStatement update = connection.prepareStatement(SET_END);
             ResultSet rs = select.executeQuery()) {
            while (rs.next()) {
                LocalTime start = rs.getObject("booking_time", LocalTime.class);
                int duration = rs.getInt("duration_minutes");
                if (rs.wasNull() || duration <= 0) {
                    duration = DEFAULT_DURATION_MINUTES;
                }
                update.setObject(1, endTimeOf(start, duration));
                update.setLong(2, rs.getLong("id"));
                update.addBatch();
                if (++updated % 500 == 0) {
                    update.executeBatch();
                }
            }
            update.executeBatch();
        }
        log.info("V35: backfilled booking_end_time for {} appointment(s).", updated);
    }

    /**
     * Greedy repair: per barber and date, keep rows in precedence order (APPROVED, then lowest id)
     * unless they overlap a row already kept; deny the rest. Returns the denied ids.
     */
    static List<Long> denyOverlappingBookings(Connection connection) throws SQLException {
        List<ActiveRow> losers = new ArrayList<>();
        try (PreparedStatement select = connection.prepareStatement(SELECT_ACTIVE);
             ResultSet rs = select.executeQuery()) {
            List<ActiveRow> kept = new ArrayList<>();
            String barber = null;
            LocalDate date = null;
            while (rs.next()) {
                ActiveRow row = new ActiveRow(rs.getLong("id"), rs.getString("barber_name"),
                        rs.getObject("booking_date", LocalDate.class),
                        rs.getObject("booking_time", LocalTime.class),
                        rs.getObject("booking_end_time", LocalTime.class),
                        rs.getString("customer_email"), rs.getString("customer_name"),
                        rs.getString("service_type"), rs.getInt("upcoming") == 1);
                if (!Objects.equals(barber, row.barberName()) || !Objects.equals(date, row.bookingDate())) {
                    kept.clear();
                    barber = row.barberName();
                    date = row.bookingDate();
                }
                if (kept.stream().anyMatch(row::overlaps)) {
                    losers.add(row);
                } else {
                    kept.add(row);
                }
            }
        }
        if (losers.isEmpty()) {
            return List.of();
        }

        int notified = 0;
        try (PreparedStatement deny = connection.prepareStatement(DENY);
             PreparedStatement notify = connection.prepareStatement(NOTIFY)) {
            for (ActiveRow row : losers) {
                deny.setLong(1, row.id());
                deny.executeUpdate();
                if (row.upcoming() && row.customerEmail() != null) {
                    notify.setString(1, safe(row.customerEmail()));
                    notify.setString(2, declinedMessage(row));
                    notify.executeUpdate();
                    notified++;
                }
            }
        }
        List<Long> ids = losers.stream().map(ActiveRow::id).toList();
        log.warn("V35: set {} overlapping active appointment(s) to DENIED before adding {} "
                + "({} customer notice(s) queued): ids {}", ids.size(), EXCLUSION_CONSTRAINT, notified, ids);
        return ids;
    }

    /** Identical wording to NotificationOutboxWriter's DENIED status-change message. */
    static String declinedMessage(ActiveRow row) {
        return "Subject: Appointment DECLINED - " + String.format(
                "Dear %s, unfortunately we could not accommodate your %s appointment with %s on %s at %s. "
                        + "Please try booking another slot.",
                safe(row.customerName()), safe(row.serviceType()), safe(row.barberName()),
                row.bookingDate(), row.bookingTime().toString().substring(0, 5));
    }

    private static String safe(String value) {
        return value != null ? value.replace("\n", "").replace("\r", "") : "";
    }

    private static void addExclusionConstraint(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("CREATE EXTENSION IF NOT EXISTS btree_gist");
        } catch (SQLException e) {
            throw new IllegalStateException("V35 needs the PostgreSQL extension btree_gist for the "
                    + EXCLUSION_CONSTRAINT + " exclusion constraint, but it could not be created ("
                    + e.getMessage() + "). Install the PostgreSQL contrib package if it is missing, and "
                    + "either grant the migration user CREATE on the database or have a superuser run "
                    + "'CREATE EXTENSION btree_gist;' in this database, then restart.", e);
        }
        try (Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE appointments DROP CONSTRAINT IF EXISTS " + EXCLUSION_CONSTRAINT);
            statement.execute("ALTER TABLE appointments ADD CONSTRAINT " + EXCLUSION_CONSTRAINT
                    + " EXCLUDE USING gist (barber_name WITH =, "
                    + "tsrange(booking_date + booking_time, booking_date + booking_end_time) WITH &&) "
                    + "WHERE (status IN ('PENDING', 'APPROVED'))");
        }
    }

    record ActiveRow(long id, String barberName, LocalDate bookingDate, LocalTime bookingTime,
                     LocalTime bookingEndTime, String customerEmail, String customerName,
                     String serviceType, boolean upcoming) {

        /** Half-open {@code [start, end)} overlap; an empty interval overlaps nothing (as in PostgreSQL). */
        boolean overlaps(ActiveRow other) {
            return bookingTime.isBefore(bookingEndTime) && other.bookingTime.isBefore(other.bookingEndTime)
                    && bookingTime.isBefore(other.bookingEndTime) && other.bookingTime.isBefore(bookingEndTime);
        }
    }
}
