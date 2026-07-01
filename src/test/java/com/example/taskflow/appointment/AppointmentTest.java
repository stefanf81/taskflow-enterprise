package com.example.taskflow.appointment;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;

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
}
