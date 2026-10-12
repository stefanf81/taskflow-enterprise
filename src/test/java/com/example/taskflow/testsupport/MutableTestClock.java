package com.example.taskflow.testsupport;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A {@link Clock} whose instant tests can set and advance, e.g. to move past an appointment's start
 * or an outbox backoff without sleeping. Register it as a {@code @Primary} bean in a
 * {@code @TestConfiguration} to replace the shop clock in a Spring context.
 */
public class MutableTestClock extends Clock {

    private final AtomicReference<Instant> now;
    private final ZoneId zone;

    public MutableTestClock(Instant start) {
        this(start, ZoneOffset.UTC);
    }

    public MutableTestClock(Instant start, ZoneId zone) {
        this.now = new AtomicReference<>(start);
        this.zone = zone;
    }

    public void set(Instant instant) {
        now.set(instant);
    }

    public void advance(Duration duration) {
        now.updateAndGet(current -> current.plus(duration));
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId newZone) {
        return new MutableTestClock(now.get(), newZone);
    }

    @Override
    public Instant instant() {
        return now.get();
    }
}
