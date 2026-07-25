package com.example.taskflow.appointment;

import com.fasterxml.jackson.annotation.JsonTypeInfo;

@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS, property = "@class")
public record AppointmentStats(
    long total,
    long pending,
    long approved,
    long denied,
    long overdue,
    int progress,
    double approvedRevenue
) {
    public AppointmentStats {
        if (progress == 0 && total > 0 && approved > 0) {
            progress = (int) Math.round(((double) approved / total) * 100);
        }
    }
}
