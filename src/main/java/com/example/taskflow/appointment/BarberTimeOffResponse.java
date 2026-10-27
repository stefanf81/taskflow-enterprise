package com.example.taskflow.appointment;

import org.jspecify.annotations.Nullable;

import java.time.LocalDate;

public record BarberTimeOffResponse(Long id, LocalDate startDate, LocalDate endDate, @Nullable String reason) {

    public static BarberTimeOffResponse fromEntity(BarberTimeOff timeOff) {
        return new BarberTimeOffResponse(
                timeOff.getId(),
                timeOff.getStartDate(),
                timeOff.getEndDate(),
                timeOff.getReason()
        );
    }
}
