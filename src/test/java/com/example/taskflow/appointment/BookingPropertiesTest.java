package com.example.taskflow.appointment;

import org.junit.jupiter.api.Test;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class BookingPropertiesTest {

    @Test
    void defaultsMatchTheSeededBarbersAndTheDocumentedLimits() {
        BookingProperties defaults = BookingProperties.defaults();

        assertEquals(90, defaults.maxAdvanceDays());
        assertEquals(5, defaults.maxActivePerEmail());
        assertEquals(LocalTime.of(9, 0), defaults.shiftStart());
        assertEquals(LocalTime.of(17, 0), defaults.shiftEnd());
        assertEquals(List.of(1, 2, 3, 4, 5, 6), defaults.defaultWorkingDays());
    }

    @Test
    void invalidConfigurationFailsFast() {
        assertThrows(IllegalArgumentException.class, () -> new BookingProperties(0, 5, "09:00", "17:00", List.of(1)));
        assertThrows(IllegalArgumentException.class, () -> new BookingProperties(90, 0, "09:00", "17:00", List.of(1)));
        assertThrows(IllegalArgumentException.class, () -> new BookingProperties(90, 5, "17:00", "09:00", List.of(1)));
        assertThrows(RuntimeException.class, () -> new BookingProperties(90, 5, "9am", "17:00", List.of(1)));
        assertThrows(RuntimeException.class, () -> new BookingProperties(90, 5, "09:00", "17:00", List.of(0)));
        assertThrows(RuntimeException.class, () -> new BookingProperties(90, 5, "09:00", "17:00", List.of(8)));
    }
}
