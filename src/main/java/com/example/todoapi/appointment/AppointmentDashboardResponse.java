package com.example.todoapi.appointment;

import org.springframework.data.domain.Page;

public record AppointmentDashboardResponse(
    Page<AppointmentResponse> page,
    AppointmentStats stats
) {}
