package com.example.taskflow.appointment;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;
import java.util.List;

public record ScheduleChangeRequest(
        @NotNull @Size(max = 7) List<@NotNull(message = "Schedule day must not be null") @Valid ScheduleDay> days,
        @NotBlank @Size(max = 64) String expectedRevision,
        @Nullable @Size(max = 64) String expectedConflicts,
        boolean cancelConflictingAppointments) {}
