package com.example.taskflow.appointment;

import com.example.taskflow.catalog.ServiceItem;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class AppointmentTest {

    @Test
    void testAppointmentPrePersistAndPreUpdate() {
        Appointment appointment = new Appointment("John", "john@test.com", "123", "Barber", LocalDate.now(), "10:00", "Haircut");
        
        // Trigger PrePersist
        appointment.onCreate();
        assertNotNull(appointment.getPublicId());
        assertNotNull(appointment.getCreatedAt());
        assertNotNull(appointment.getUpdatedAt());

        // Trigger PreUpdate
        LocalDateTime initialUpdate = appointment.getUpdatedAt();
        appointment.onUpdate();
        assertNotNull(appointment.getUpdatedAt());

        // Test getters and setters
        appointment.setId(1L);
        assertEquals(1L, appointment.getId());
        
        appointment.setPublicId("pub-id");
        assertEquals("pub-id", appointment.getPublicId());
        
        appointment.setCustomerName("Jane");
        assertEquals("Jane", appointment.getCustomerName());
        
        appointment.setCustomerEmail("jane@test.com");
        assertEquals("jane@test.com", appointment.getCustomerEmail());
        
        appointment.setCustomerPhone("456");
        assertEquals("456", appointment.getCustomerPhone());
        
        appointment.setBarberName("Sara");
        assertEquals("Sara", appointment.getBarberName());
        
        LocalDate newDate = LocalDate.now().plusDays(1);
        appointment.setBookingDate(newDate);
        assertEquals(newDate, appointment.getBookingDate());
        
        appointment.setBookingTime("11:00");
        assertEquals("11:00", appointment.getBookingTime());
        
        appointment.setServiceType("Shave");
        assertEquals("Shave", appointment.getServiceType());
        
        appointment.setStatus("APPROVED");
        assertEquals("APPROVED", appointment.getStatus());
        
        LocalDateTime now = LocalDateTime.now();
        appointment.setCreatedAt(now);
        assertEquals(now, appointment.getCreatedAt());
        
        appointment.setUpdatedAt(now);
        assertEquals(now, appointment.getUpdatedAt());
    }

    @Test
    void testPrePersistWithExistingPublicId() {
        Appointment appointment = new Appointment();
        appointment.setPublicId("existing-id");
        appointment.onCreate();

        assertEquals("existing-id", appointment.getPublicId());
    }

    // ── V35: stored end time ─────────────────────────────────────────────────

    @Test
    void endTimeIsDerivedFromTheStartAndTheServiceDuration() {
        Appointment appointment = new Appointment("John", "john@test.com", "123", "Barber",
                LocalDate.now(), "10:00", "Haircut");
        assertEquals(LocalTime.of(11, 0), appointment.getBookingEndTime(), "no service: one 60-minute grid step");

        appointment.setService(new ServiceItem("Long", BigDecimal.TEN, 90, "hair", ""));
        assertEquals(LocalTime.of(11, 30), appointment.getBookingEndTime());

        appointment.setBookingTime("13:00");
        assertEquals(LocalTime.of(14, 30), appointment.getBookingEndTime());

        appointment.setService(new ServiceItem("Zero", BigDecimal.TEN, 0, "hair", ""));
        assertEquals(LocalTime.of(14, 0), appointment.getBookingEndTime(), "no positive duration: 60 minutes");
    }

    @Test
    void endTimeIsFilledOnPersistWhenNeverDerived() {
        Appointment appointment = new Appointment();
        appointment.setBookingEndTime(null);
        appointment.onCreate();
        assertEquals(null, appointment.getBookingEndTime(), "nothing to derive from without a start time");

        appointment.setBookingTime("09:00");
        appointment.setBookingEndTime(null);
        appointment.onCreate();
        assertEquals(LocalTime.of(10, 0), appointment.getBookingEndTime());
    }

    @Test
    void endTimeIsClampedBeforeMidnightInsteadOfWrapping() {
        assertEquals(LocalTime.of(17, 0), Appointment.endTimeOf(LocalTime.of(16, 0), 60));
        assertEquals(LocalTime.of(23, 59, 59), Appointment.endTimeOf(LocalTime.of(23, 30), 60));
        assertEquals(LocalTime.of(23, 59, 59), Appointment.endTimeOf(LocalTime.of(23, 59, 59), 30));
    }
}
