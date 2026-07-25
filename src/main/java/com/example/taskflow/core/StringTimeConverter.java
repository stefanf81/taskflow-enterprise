package com.example.taskflow.core;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import java.sql.Time;

/**
 * Converts between the {@code booking_time} column (SQL {@code TIME} type)
 * and the entity's {@code String} field ({@code HH:mm} format).
 *
 * <p>Flyway migration V22 changed the column from {@code VARCHAR} to
 * {@code TIME} for better temporal semantics, but the entity field remained
 * {@code String}. This converter bridges that mismatch without requiring a
 * full entity refactor to {@code LocalTime}.
 */
@Converter(autoApply = false)
public class StringTimeConverter implements AttributeConverter<String, Time> {

    @Override
    public Time convertToDatabaseColumn(String attribute) {
        if (attribute == null || attribute.isBlank()) {
            return null;
        }
        // Booking times are always HH:mm; pad seconds if needed.
        String withSeconds = attribute.trim();
        if (withSeconds.length() == 5) {
            withSeconds += ":00";
        }
        return Time.valueOf(withSeconds);
    }

    @Override
    public String convertToEntityAttribute(Time dbData) {
        if (dbData == null) {
            return null;
        }
        // Return only HH:mm to match the application's format.
        return dbData.toString().substring(0, 5);
    }
}