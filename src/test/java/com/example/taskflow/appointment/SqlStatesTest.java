package com.example.taskflow.appointment;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;

/** {@link SqlStates}: SQLSTATE checks on the cause chain. */
class SqlStatesTest {

    @Test
    void testIsSlotConstraintViolationRecognisesUniqueAndExclusionViolationsOnly() {
        assertTrue(
                SqlStates.isSlotConstraintViolation(new RuntimeException(new java.sql.SQLException("dup", "23505"))));
        assertTrue(SqlStates.isSlotConstraintViolation(
                new RuntimeException(new java.sql.SQLException("overlap", "23P01"))));
        assertFalse(
                SqlStates.isSlotConstraintViolation(new RuntimeException(new java.sql.SQLException("fk", "23503"))));
        assertFalse(SqlStates.isSlotConstraintViolation(new RuntimeException("no sql state")));
    }

    @Test
    void testIsDeadlockLooksForSqlState40P01InTheCauseChain() {
        assertTrue(SqlStates.isDeadlock(new RuntimeException(new java.sql.SQLException("deadlock detected", "40P01"))));
        assertFalse(SqlStates.isDeadlock(new RuntimeException(new java.sql.SQLException("lock timeout", "55P03"))));
        assertFalse(SqlStates.isDeadlock(new RuntimeException("no sql state")));
    }
}
