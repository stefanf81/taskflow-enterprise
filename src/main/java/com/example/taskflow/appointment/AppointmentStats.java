package com.example.taskflow.appointment;

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
