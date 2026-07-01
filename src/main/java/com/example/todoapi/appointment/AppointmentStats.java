package com.example.todoapi.appointment;

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
) {}
