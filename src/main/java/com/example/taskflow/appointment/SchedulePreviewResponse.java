package com.example.taskflow.appointment;

/** No customer data: a confirmation must match the set of bookings the owner previewed. */
public record SchedulePreviewResponse(int conflictCount, String conflictsRevision) {}
