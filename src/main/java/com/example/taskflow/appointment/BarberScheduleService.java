package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
class BarberScheduleService {
    private final BarberRepository barbers;
    private final BarberScheduleRepository schedules;
    private final AppointmentRepository appointments;
    private final ApplicationEventPublisher events;
    private final AppointmentChangePublisher changes;
    private final Clock clock;

    BarberScheduleService(BarberRepository barbers, BarberScheduleRepository schedules,
                         AppointmentRepository appointments, ApplicationEventPublisher events,
                         AppointmentChangePublisher changes, Clock clock) {
        this.barbers = barbers;
        this.schedules = schedules;
        this.appointments = appointments;
        this.events = events;
        this.changes = changes;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public BarberScheduleResponse get(Long barberId) {
        if (!barbers.existsById(barberId)) throw new ResourceNotFoundException("Barber not found.");
        return response(schedules.findByBarberIdOrderByDayOfWeek(barberId));
    }

    @Transactional(readOnly = true)
    public SchedulePreviewResponse preview(Long barberId, ScheduleChangeRequest request) {
        Barber barber = barbers.findById(barberId)
                .orElseThrow(() -> new ResourceNotFoundException("Barber not found."));
        validate(request.days());
        checkRevision(request, schedules.findByBarberIdOrderByDayOfWeek(barberId));
        List<Appointment> conflicts = conflicts(barber, request.days());
        return new SchedulePreviewResponse(conflicts.size(), conflictRevision(conflicts));
    }

    @Transactional
    public BarberScheduleResponse update(Long barberId, ScheduleChangeRequest request) {
        Barber barber = barbers.findByIdForUpdate(barberId)
                .orElseThrow(() -> new ResourceNotFoundException("Barber not found."));
        validate(request.days());
        List<BarberSchedule> current = schedules.findByBarberIdOrderByDayOfWeek(barberId);
        checkRevision(request, current);
        List<Appointment> conflicts = conflicts(barber, request.days());
        if (!conflicts.isEmpty() && (!request.cancelConflictingAppointments()
                || !conflictRevision(conflicts).equals(request.expectedConflicts()))) {
            throw new ConflictException("Preview the affected bookings and confirm their cancellation before saving.");
        }
        Map<Integer, BarberSchedule> remaining = current.stream()
                .collect(Collectors.toMap(BarberSchedule::getDayOfWeek, Function.identity()));
        for (ScheduleDay day : request.days()) {
            BarberSchedule row = remaining.remove(day.dayOfWeek());
            if (row == null) {
                row = new BarberSchedule();
                row.setBarber(barber);
                row.setDayOfWeek(day.dayOfWeek());
            }
            row.setStartTime(LocalTime.parse(day.opens()));
            row.setEndTime(LocalTime.parse(day.closes()));
            schedules.save(row);
        }
        schedules.deleteAll(remaining.values());
        for (Appointment appointment : conflicts) {
            appointment.setStatus(AppointmentStatus.CANCELLED);
            changes.cancelled(appointment, AppointmentCancelledEvent.CancelledBy.BARBER_UNAVAILABLE);
            changes.adminEvent(com.example.taskflow.appointment.stream.AppointmentAdminEvent.Type.UPDATED,
                    appointment.getId());
        }
        appointments.flush();
        events.publishEvent(new BarberRosterChangedEvent());
        events.publishEvent(AvailabilityChangedEvent.allBarbers());
        return response(schedules.findByBarberIdOrderByDayOfWeek(barberId));
    }

    static void validate(List<ScheduleDay> days) {
        if (days == null || days.size() > 7 || days.stream().map(ScheduleDay::dayOfWeek).distinct().count() != days.size()) {
            throw new IllegalArgumentException("Supply at most one shift per weekday.");
        }
        for (ScheduleDay day : days) {
            if (day.dayOfWeek() < 1 || day.dayOfWeek() > 7
                    || !LocalTime.parse(day.opens()).isBefore(LocalTime.parse(day.closes()))) {
                throw new IllegalArgumentException("Each shift must open before it closes on the same day.");
            }
        }
    }

    private List<Appointment> conflicts(Barber barber, List<ScheduleDay> days) {
        Map<Integer, ScheduleDay> byDay = days.stream().collect(Collectors.toMap(ScheduleDay::dayOfWeek, Function.identity()));
        LocalDateTime now = LocalDateTime.now(clock);
        return appointments.findActiveForBarberInRange(barber.getName(), now.toLocalDate(), LocalDate.of(9999, 12, 31))
                .stream().filter(a -> LocalDateTime.of(a.getBookingDate(), LocalTime.parse(a.getBookingTime())).isAfter(now))
                .filter(a -> {
                    ScheduleDay day = byDay.get(a.getBookingDate().getDayOfWeek().getValue());
                    return day == null || LocalTime.parse(a.getBookingTime()).isBefore(LocalTime.parse(day.opens()))
                            || a.getBookingEndTime().isAfter(LocalTime.parse(day.closes()));
                }).sorted(Comparator.comparing(Appointment::getId)).toList();
    }

    private static void checkRevision(ScheduleChangeRequest request, List<BarberSchedule> current) {
        if (!response(current).revision().equals(request.expectedRevision())) {
            throw new ConflictException("The schedule changed. Reload it before saving.");
        }
    }

    private static String conflictRevision(List<Appointment> conflicts) {
        return hash(conflicts.stream().map(a -> a.getId() + ":" + a.getVersion()).collect(Collectors.joining(";")));
    }

    private static BarberScheduleResponse response(List<BarberSchedule> schedules) {
        List<ScheduleDay> days = schedules.stream().sorted(Comparator.comparing(BarberSchedule::getDayOfWeek))
                .map(s -> new ScheduleDay(s.getDayOfWeek(), s.getStartTime().toString().substring(0, 5),
                        s.getEndTime().toString().substring(0, 5))).toList();
        return new BarberScheduleResponse(days, hash(days.toString()));
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
