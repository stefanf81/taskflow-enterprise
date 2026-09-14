package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Time;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Assigns a concrete barber to legacy "No Preference (First Available)"
 * appointments and denies any row no barber can serve.
 *
 * <p>Historically the sentinel string was persisted verbatim with a null
 * {@code barber_id}. Per-barber availability queries could not see those rows,
 * and the partial unique slot index treated the sentinel as a distinct
 * fictitious barber, so a real barber could be double-booked at the same slot.
 * The application now resolves the sentinel to a concrete barber before insert;
 * this migration repairs rows booked before that change.
 *
 * <p>Rows are processed in booking order. For each row the first barber who is
 * scheduled for the weekday, within working hours, not on time off, and not
 * already booked at that slot is assigned. If no barber can serve the row it is
 * marked DENIED — the same conflict semantics V25 uses when collapsing
 * duplicates. The candidate query excludes active appointments with the same
 * barber/date/time, so this migration never creates a unique-index collision.
 *
 * <p>Runs identically on PostgreSQL and H2 (PostgreSQL compatibility mode).
 */
public class V26__assign_sentinel_appointments extends BaseJavaMigration {

    private static final String SENTINEL = "No Preference (First Available)";

    private static final String SELECT_SENTINEL_ROWS =
            "SELECT id, booking_date, booking_time FROM appointments "
                    + "WHERE barber_name = ? AND status IN ('PENDING', 'APPROVED') "
                    + "ORDER BY booking_date, booking_time, id";

    private static final String SELECT_AVAILABLE_BARBER =
            "SELECT b.id, b.name FROM barbers b "
                    + "JOIN barber_schedules s ON s.barber_id = b.id "
                    + "WHERE s.day_of_week = ? AND s.start_time <= ? AND s.end_time > ? "
                    + "AND NOT EXISTS (SELECT 1 FROM barber_time_off t WHERE t.barber_id = b.id "
                    + "AND ? BETWEEN t.start_date AND t.end_date) "
                    + "AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.barber_name = b.name "
                    + "AND a.booking_date = ? AND a.booking_time = ? AND a.status IN ('PENDING', 'APPROVED')) "
                    + "ORDER BY b.id LIMIT 1";

    private static final String ASSIGN_BARBER =
            "UPDATE appointments SET barber_name = ?, barber_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";

    private static final String DENY_UNASSIGNABLE =
            "UPDATE appointments SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP WHERE id = ?";

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();

        List<SentinelRow> rows = new ArrayList<>();
        try (PreparedStatement select = connection.prepareStatement(SELECT_SENTINEL_ROWS)) {
            select.setString(1, SENTINEL);
            try (ResultSet rs = select.executeQuery()) {
                while (rs.next()) {
                    Time time = rs.getTime("booking_time");
                    rows.add(new SentinelRow(
                            rs.getLong("id"),
                            rs.getDate("booking_date").toLocalDate(),
                            time == null ? null : time.toLocalTime()));
                }
            }
        }

        for (SentinelRow row : rows) {
            Long barberId = null;
            String barberName = null;
            if (row.bookingTime() != null) {
                try (PreparedStatement candidate = connection.prepareStatement(SELECT_AVAILABLE_BARBER)) {
                    candidate.setInt(1, row.bookingDate().getDayOfWeek().getValue());
                    candidate.setTime(2, Time.valueOf(row.bookingTime()));
                    candidate.setTime(3, Time.valueOf(row.bookingTime()));
                    candidate.setDate(4, java.sql.Date.valueOf(row.bookingDate()));
                    candidate.setDate(5, java.sql.Date.valueOf(row.bookingDate()));
                    candidate.setTime(6, Time.valueOf(row.bookingTime()));
                    try (ResultSet rs = candidate.executeQuery()) {
                        if (rs.next()) {
                            barberId = rs.getLong("id");
                            barberName = rs.getString("name");
                        }
                    }
                }
            }

            if (barberId != null) {
                try (PreparedStatement update = connection.prepareStatement(ASSIGN_BARBER)) {
                    update.setString(1, barberName);
                    update.setLong(2, barberId);
                    update.setLong(3, row.id());
                    update.executeUpdate();
                }
            } else {
                try (PreparedStatement deny = connection.prepareStatement(DENY_UNASSIGNABLE)) {
                    deny.setLong(1, row.id());
                    deny.executeUpdate();
                }
            }
        }
    }

    private record SentinelRow(long id, LocalDate bookingDate, LocalTime bookingTime) {
    }
}
