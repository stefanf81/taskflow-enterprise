package com.example.taskflow.core;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.ZoneId;

/**
 * The shop's wall clock.
 *
 * <p>Appointments are stored as a plain local date and time, so "is this in the
 * past?", "is it tomorrow?" and similar questions are only meaningful in the
 * shop's own time zone. A container normally runs in UTC, which is hours off
 * for a shop elsewhere — a reminder for a day-D booking would go out at the wrong
 * local time, and "today" would roll over at the wrong moment. Inject this
 * {@link Clock} (and use {@code LocalDate.now(clock)} / {@code LocalDateTime.now(clock)})
 * instead of calling {@code now()} with no argument.
 *
 * <p>Set {@code app.shop.time-zone} (an IANA id such as {@code America/New_York})
 * per deployment; it defaults to UTC, which preserves the previous behaviour.
 * Tests can override the bean with a fixed clock.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock shopClock(@Value("${app.shop.time-zone:UTC}") String timeZone) {
        return Clock.system(ZoneId.of(timeZone));
    }
}
