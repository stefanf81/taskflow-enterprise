package com.example.taskflow.appointment;

import java.time.LocalDate;
import org.jspecify.annotations.Nullable;

public record BarberTimeOffResponse(
        Long id,
        LocalDate startDate,
        LocalDate endDate,
        @Nullable String reason) {

    public static BarberTimeOffResponse fromEntity(BarberTimeOff timeOff) {
        return new BarberTimeOffResponse(
                timeOff.getId(), timeOff.getStartDate(), timeOff.getEndDate(), timeOff.getReason());
    }
}
