package com.example.taskflow.notification;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OutboxBackoffTest {

    @Test
    void delayDoublesFromThirtySeconds() {
        assertEquals(Duration.ofSeconds(30), OutboxBackoff.delayAfter(1));
        assertEquals(Duration.ofSeconds(60), OutboxBackoff.delayAfter(2));
        assertEquals(Duration.ofMinutes(2), OutboxBackoff.delayAfter(3));
        assertEquals(Duration.ofMinutes(32), OutboxBackoff.delayAfter(7));
    }

    @Test
    void delayIsCappedAtOneHour() {
        // 30 s * 2^7 = 64 min is the first value over the cap
        assertEquals(Duration.ofHours(1), OutboxBackoff.delayAfter(8));
        assertEquals(Duration.ofHours(1), OutboxBackoff.delayAfter(OutboxBackoff.MAX_ATTEMPTS));
        // the exponent is clamped, so a huge count cannot overflow the shift
        assertEquals(Duration.ofHours(1), OutboxBackoff.delayAfter(Integer.MAX_VALUE));
    }

    @Test
    void aNonPositiveCountIsTreatedAsTheFirstFailure() {
        assertEquals(Duration.ofSeconds(30), OutboxBackoff.delayAfter(0));
        assertEquals(Duration.ofSeconds(30), OutboxBackoff.delayAfter(-5));
    }
}
