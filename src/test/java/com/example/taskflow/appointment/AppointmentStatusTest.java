package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AppointmentStatusTest {

    @Test
    void fromStringParsesEveryStatusCaseInsensitivelyAndTrimmed() {
        assertEquals(AppointmentStatus.PENDING, AppointmentStatus.fromString("pending"));
        assertEquals(AppointmentStatus.APPROVED, AppointmentStatus.fromString(" Approved "));
        assertEquals(AppointmentStatus.DENIED, AppointmentStatus.fromString("DENIED"));
        assertEquals(AppointmentStatus.CANCELLED, AppointmentStatus.fromString("cancelled"));
    }

    @Test
    void blankOrNullDefaultsToPendingForCallersThatMeanNoFilter() {
        assertEquals(AppointmentStatus.PENDING, AppointmentStatus.fromString(null));
        assertEquals(AppointmentStatus.PENDING, AppointmentStatus.fromString(""));
        assertEquals(AppointmentStatus.PENDING, AppointmentStatus.fromString("   "));
    }

    @Test
    void unknownStatusIsRejectedInsteadOfSilentlyBecomingPending() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> AppointmentStatus.fromString("BOGUS"));
        assertTrue(ex.getMessage().contains("Unknown status 'BOGUS'"), ex.getMessage());
        assertTrue(ex.getMessage().contains("CANCELLED"), "lists the valid values: " + ex.getMessage());
        assertThrows(IllegalArgumentException.class, () -> new Appointment().setStatus("nonsense"));
    }

    @Test
    void errorMessageDoesNotEchoControlCharactersOrUnboundedInput() {
        String hostile = "x\r\nINJECT" + "y".repeat(500);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> AppointmentStatus.fromString(hostile));
        assertFalse(ex.getMessage().contains("\n"));
        assertFalse(ex.getMessage().contains("\r"));
        assertTrue(ex.getMessage().length() < 200);
    }

    @Test
    void onlyPendingAndApprovedAreActive() {
        assertTrue(AppointmentStatus.PENDING.isActive());
        assertTrue(AppointmentStatus.APPROVED.isActive());
        assertFalse(AppointmentStatus.DENIED.isActive());
        assertFalse(AppointmentStatus.CANCELLED.isActive());
        assertEquals(java.util.List.of(AppointmentStatus.PENDING, AppointmentStatus.APPROVED), AppointmentStatus.ACTIVE);
    }
}
