package com.example.taskflow.appointment;

import java.sql.SQLException;

/** SQLSTATE checks on a data-access exception's cause chain, shared by booking and approval. */
final class SqlStates {

    private SqlStates() {
    }

    /**
     * H1: Walk the exception cause chain looking for a {@link SQLException}
     * whose SQLState is {@code "23505"} (the SQL-standard code for unique violation
     * shared by PostgreSQL and H2) or {@code "23P01"} (PostgreSQL exclusion_violation,
     * raised by the {@code appointments_no_overlap} constraint from V35). Other integrity
     * violations (FK = 23503, NOT NULL = 23502, CHECK = 23514) will not match, allowing
     * the caller to distinguish a genuine slot/idempotency collision from other data issues.
     */
    static boolean isSlotConstraintViolation(Throwable ex) {
        Throwable cause = ex;
        while (cause != null) {
            if (cause instanceof SQLException sqlEx) {
                if ("23505".equals(sqlEx.getSQLState()) || "23P01".equals(sqlEx.getSQLState())) {
                    return true;
                }
            }
            cause = cause.getCause();
        }
        return false;
    }

    /** PostgreSQL {@code deadlock_detected} (SQLSTATE 40P01) anywhere in the cause chain. */
    static boolean isDeadlock(Throwable ex) {
        Throwable cause = ex;
        while (cause != null) {
            if (cause instanceof SQLException sqlEx && "40P01".equals(sqlEx.getSQLState())) {
                return true;
            }
            cause = cause.getCause();
        }
        return false;
    }
}
