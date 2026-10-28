package db.migration;

import com.example.taskflow.appointment.internal.Appointment;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V35's own copies of the end-time and overlap rules must agree with the application's
 * ({@code Appointment.endTimeOf}, PostgreSQL's {@code tsrange &&}). The migration keeps copies so that
 * a later change to the entity can never alter what an already released migration does. The data
 * scenarios run in {@code AbstractDataMigrationsTest} (H2 and PostgreSQL).
 */
class V35AppointmentEndTimeTest {

    @Test
    void endTimeMatchesTheEntity() {
        for (String start : new String[] {"00:00", "09:00", "16:00", "22:45", "23:00", "23:30", "23:59:59"}) {
            for (int minutes : new int[] {1, 25, 30, 45, 60, 90, 120, 600}) {
                LocalTime time = LocalTime.parse(start);
                assertEquals(Appointment.endTimeOf(time, minutes),
                        V35__appointment_end_time_and_overlap_constraint.endTimeOf(time, minutes), start + " + " + minutes);
            }
        }
        assertEquals(Appointment.DEFAULT_DURATION_MINUTES,
                V35__appointment_end_time_and_overlap_constraint.DEFAULT_DURATION_MINUTES);
    }

    @Test
    void overlapIsHalfOpenAndEmptyIntervalsOverlapNothing() {
        assertTrue(row("10:00", "11:30").overlaps(row("11:00", "12:00")));
        assertTrue(row("11:00", "12:00").overlaps(row("10:00", "11:30")));
        assertTrue(row("10:00", "12:00").overlaps(row("10:30", "11:00")));
        assertFalse(row("10:00", "11:00").overlaps(row("11:00", "12:00")), "back to back");
        assertFalse(row("23:59:59", "23:59:59").overlaps(row("23:00", "23:59:59")), "empty interval");
    }

    private static V35__appointment_end_time_and_overlap_constraint.ActiveRow row(String start, String end) {
        return new V35__appointment_end_time_and_overlap_constraint.ActiveRow(1, "B", LocalDate.of(2031, 1, 6),
                LocalTime.parse(start), LocalTime.parse(end), "c@x.test", "C", "Cut", true);
    }
}
