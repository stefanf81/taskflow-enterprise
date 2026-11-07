package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.core.ConflictException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** RFC 5545 export with UTC instants, stable UID, CRLF and UTF-8-octet-aware line folding. */
@Service
class AppointmentCalendarService {
    private static final DateTimeFormatter UTC = DateTimeFormatter.ofPattern("uuuuMMdd'T'HHmmss'Z'")
            .withZone(ZoneOffset.UTC);
    private final AppointmentOwnership ownership;
    private final Clock clock;

    AppointmentCalendarService(AppointmentOwnership ownership, Clock clock) {
        this.ownership = ownership;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public CalendarExportResponse export(String publicId, String email) {
        Appointment item = ownership.requireOwned(publicId, email);
        if (item.getStatusEnum() == AppointmentStatus.DENIED || item.getStatusEnum() == AppointmentStatus.CANCELLED) {
            throw new ConflictException("A declined or cancelled appointment cannot be added to a calendar.");
        }
        StringBuilder ics = new StringBuilder();
        line(ics, "BEGIN:VCALENDAR");
        line(ics, "VERSION:2.0");
        line(ics, "PRODID:-//TaskFlow//Appointments//EN");
        line(ics, "CALSCALE:GREGORIAN");
        line(ics, "METHOD:PUBLISH");
        line(ics, "BEGIN:VEVENT");
        line(ics, "UID:" + text(item.getPublicId()) + "@taskflow");
        line(ics, "DTSTAMP:" + UTC.format(clock.instant()));
        line(ics, "DTSTART:" + UTC.format(LocalDateTime.of(item.getBookingDate(),
                LocalTime.parse(item.getBookingTime())).atZone(clock.getZone()).toInstant()));
        // The stored end is authoritative even after a catalog duration edit.
        line(ics, "DTEND:" + UTC.format(LocalDateTime.of(item.getBookingDate(), item.getBookingEndTime())
                .atZone(clock.getZone()).toInstant()));
        line(ics, "SEQUENCE:" + (item.getVersion() == null ? 0 : item.getVersion()));
        line(ics, "SUMMARY:TaskFlow appointment");
        line(ics, "DESCRIPTION:" + text(item.getServiceType() + " with " + item.getBarberName()));
        line(ics, "STATUS:" + (item.getStatusEnum() == AppointmentStatus.APPROVED ? "CONFIRMED" : "TENTATIVE"));
        line(ics, "END:VEVENT");
        line(ics, "END:VCALENDAR");
        // No customer name, address, phone, e-mail, attendee or internal database ID is exported.
        String safeId = item.getPublicId().replaceAll("[^A-Za-z0-9-]", "");
        return new CalendarExportResponse(ics.toString(), "appointment-" + safeId + ".ics");
    }

    private static String text(String value) {
        return value.replace("\\", "\\\\").replace("\r\n", "\n").replace('\r', '\n')
                .replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")
                .replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", "");
    }

    private static void line(StringBuilder target, String value) {
        int octets = 0;
        for (int offset = 0; offset < value.length();) {
            int point = value.codePointAt(offset);
            String character = new String(Character.toChars(point));
            int length = character.getBytes(StandardCharsets.UTF_8).length;
            if (octets + length > 75) {
                target.append("\r\n ");
                octets = 1; // the continuation space also counts toward the 75-octet limit
            }
            target.append(character);
            octets += length;
            offset += Character.charCount(point);
        }
        target.append("\r\n");
    }
}
