package com.example.taskflow.notification;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

class NotificationOutboxTest {

    @Test
    void testNotificationOutboxEntity() {
        // Test no-args constructor
        NotificationOutbox outbox1 = new NotificationOutbox();
        assertNull(outbox1.getId());
        assertNull(outbox1.getRecipient());
        assertNull(outbox1.getType());
        assertNull(outbox1.getMessage());
        assertNull(outbox1.getSentAt());
        assertNull(outbox1.getStatus());

        // Test all-args constructor
        LocalDateTime now = LocalDateTime.now();
        NotificationOutbox outbox2 = new NotificationOutbox(
                "john.doe@example.com",
                "EMAIL",
                "Hello John",
                now,
                "SENT"
        );

        outbox2.setId(10L);
        assertEquals(10L, outbox2.getId());
        assertEquals("john.doe@example.com", outbox2.getRecipient());
        assertEquals("EMAIL", outbox2.getType());
        assertEquals("Hello John", outbox2.getMessage());
        assertEquals(now, outbox2.getSentAt());
        assertEquals("SENT", outbox2.getStatus());

        // Test setters
        LocalDateTime future = now.plusDays(1);
        outbox1.setId(20L);
        outbox1.setRecipient("jane@test.com");
        outbox1.setType("SMS");
        outbox1.setMessage("Hi Jane");
        outbox1.setSentAt(future);
        outbox1.setStatus("FAILED");

        assertEquals(20L, outbox1.getId());
        assertEquals("jane@test.com", outbox1.getRecipient());
        assertEquals("SMS", outbox1.getType());
        assertEquals("Hi Jane", outbox1.getMessage());
        assertEquals(future, outbox1.getSentAt());
        assertEquals("FAILED", outbox1.getStatus());
    }
}
