package com.example.taskflow.appointment;

import java.util.List;

public record BarberScheduleResponse(List<ScheduleDay> days, String revision) {}
