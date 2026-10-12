package com.example.taskflow.appointment;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The app.booking.* property names are bound from the environment / application.properties. */
@SpringBootTest(properties = {
        "app.rate-limit.enabled=false",
        "app.booking.max-advance-days=30",
        "app.booking.max-active-per-email=2",
        "app.booking.default-shift-start=10:00",
        "app.booking.default-shift-end=15:30",
        "app.booking.default-working-days=2,4"
})
class BookingPropertiesBindingTest {

    @Autowired
    private BookingProperties properties;

    @Test
    void propertiesAreBoundFromTheEnvironment() {
        assertEquals(30, properties.maxAdvanceDays());
        assertEquals(2, properties.maxActivePerEmail());
        assertEquals(LocalTime.of(10, 0), properties.shiftStart());
        assertEquals(LocalTime.of(15, 30), properties.shiftEnd());
        assertEquals(List.of(2, 4), properties.defaultWorkingDays());
    }
}
