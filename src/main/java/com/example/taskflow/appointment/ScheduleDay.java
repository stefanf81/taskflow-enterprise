package com.example.taskflow.appointment;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** One working day in the shop's time zone; missing weekdays are closed. */
public record ScheduleDay(
        @Min(1) @Max(7) int dayOfWeek,
        @NotNull @Pattern(regexp = "^(?:[01]\\d|2[0-3]):[0-5]\\d$") String opens,
        @NotNull @Pattern(regexp = "^(?:[01]\\d|2[0-3]):[0-5]\\d$") String closes) {}
