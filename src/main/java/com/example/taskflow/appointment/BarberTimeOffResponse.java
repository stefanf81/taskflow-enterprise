package com.example.taskflow.appointment;

import java.time.LocalDate;

public record BarberTimeOffResponse(Long id, LocalDate startDate, LocalDate endDate, String reason) {

    public static BarberTimeOffResponse fromEntity(BarberTimeOff timeOff) {
        return new BarberTimeOffResponse(
                timeOff.getId(),
                timeOff.getStartDate(),
                timeOff.getEndDate(),
                timeOff.getReason()
        );
    }
}
