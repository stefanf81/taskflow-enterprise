package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.SliceImpl;
import org.springframework.data.jpa.domain.Specification;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** {@link SqlStates}: SQLSTATE checks on the cause chain. */
class SqlStatesTest {

    @Test
    void testIsSlotConstraintViolationRecognisesUniqueAndExclusionViolationsOnly() {
        assertTrue(SqlStates.isSlotConstraintViolation(
                new RuntimeException(new java.sql.SQLException("dup", "23505"))));
        assertTrue(SqlStates.isSlotConstraintViolation(
                new RuntimeException(new java.sql.SQLException("overlap", "23P01"))));
        assertFalse(SqlStates.isSlotConstraintViolation(
                new RuntimeException(new java.sql.SQLException("fk", "23503"))));
        assertFalse(SqlStates.isSlotConstraintViolation(new RuntimeException("no sql state")));
    }

    @Test
    void testIsDeadlockLooksForSqlState40P01InTheCauseChain() {
        assertTrue(SqlStates.isDeadlock(new RuntimeException(new java.sql.SQLException("deadlock detected", "40P01"))));
        assertFalse(SqlStates.isDeadlock(new RuntimeException(new java.sql.SQLException("lock timeout", "55P03"))));
        assertFalse(SqlStates.isDeadlock(new RuntimeException("no sql state")));
    }
}
