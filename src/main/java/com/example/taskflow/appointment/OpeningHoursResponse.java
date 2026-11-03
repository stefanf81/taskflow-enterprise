package com.example.taskflow.appointment;

/**
 * The shop's hours on one weekday: from the earliest start to the latest end of the barbers'
 * shifts that day.
 *
 * @param dayOfWeek ISO weekday, 1 (Monday) to 7 (Sunday)
 * @param opens     {@code HH:mm}, shop time zone
 * @param closes    {@code HH:mm}, shop time zone
 */
public record OpeningHoursResponse(int dayOfWeek, String opens, String closes) {}
