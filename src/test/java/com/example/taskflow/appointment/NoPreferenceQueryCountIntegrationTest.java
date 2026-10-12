package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.PersistenceContext;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * TODO 2.5: "No Preference" resolution runs inside the booking transaction and used to issue
 * {@code 1 + 2N} queries (time off and schedule per barber). It must now issue a constant number of
 * statements whatever the number of barbers. Counted with Hibernate's {@link Statistics} (enabled
 * only around the measured call) against the real H2 schema; the test transaction is rolled back.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
@Transactional
class NoPreferenceQueryCountIntegrationTest {

    /** A Monday far from any seed booking. */
    private static final LocalDate MONDAY = LocalDate.of(2031, 3, 10);

    @Autowired private BusySlotsService busySlotsService;
    @Autowired private BarberRepository barberRepository;
    @Autowired private BarberScheduleRepository barberScheduleRepository;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private EntityManagerFactory entityManagerFactory;
    @PersistenceContext private EntityManager entityManager;

    private int barberSequence;

    @Test
    void noPreferenceIssuesTheSameStatementsForFewAndForManyBarbers() {
        assertEquals(DayOfWeek.MONDAY, MONDAY.getDayOfWeek());
        // every barber (the seeded ones included) is booked at 10:00, so every candidate is evaluated
        barberRepository.findAll().forEach(this::bookAtTen);
        addWorkingBookedBarbers(2);
        int few = (int) barberRepository.count();

        long fewResolve = statementsDuring(() ->
                assertTrue(busySlotsService.findFirstAvailableBarber(MONDAY, "10:00", 30).isEmpty()));
        long fewLongSlots = statementsDuring(() -> busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, MONDAY.toString(), 120));

        addWorkingBookedBarbers(10);
        assertEquals(few + 10, barberRepository.count());

        long manyResolve = statementsDuring(() ->
                assertTrue(busySlotsService.findFirstAvailableBarber(MONDAY, "10:00", 30).isEmpty()));
        long manyLongSlots = statementsDuring(() -> busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, MONDAY.toString(), 120));

        assertEquals(fewResolve, manyResolve, "statement count must not grow with the number of barbers");
        assertEquals(fewLongSlots, manyLongSlots, "statement count must not grow with the number of barbers");
        // barbers, time off, schedules, bookings of the date
        assertEquals(4, manyResolve);
        assertEquals(4, manyLongSlots);

        // the first free barber in id order is still the one chosen
        Barber firstFree = barberRepository.findAllByOrderByIdAsc().get(0);
        appointmentRepository.deleteAll(appointmentRepository.findActiveForBarberOnDate(firstFree.getName(), MONDAY));
        entityManager.flush();
        assertEquals(firstFree.getId(),
                busySlotsService.findFirstAvailableBarber(MONDAY, "10:00", 30).orElseThrow().getId());
    }

    private long statementsDuring(Runnable action) {
        entityManager.flush();
        entityManager.clear();
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        boolean wasEnabled = statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        statistics.clear();
        try {
            action.run();
            return statistics.getPrepareStatementCount();
        } finally {
            statistics.setStatisticsEnabled(wasEnabled);
        }
    }

    private void addWorkingBookedBarbers(int count) {
        for (int i = 0; i < count; i++) {
            Barber barber = barberRepository.save(new Barber("Query Count Barber " + (++barberSequence),
                    "qc" + barberSequence + "@taskflow.test", "555-0199"));
            BarberSchedule schedule = new BarberSchedule();
            schedule.setBarber(barber);
            schedule.setDayOfWeek(MONDAY.getDayOfWeek().getValue());
            schedule.setStartTime(LocalTime.of(9, 0));
            schedule.setEndTime(LocalTime.of(17, 0));
            barberScheduleRepository.save(schedule);
            bookAtTen(barber);
        }
    }

    private void bookAtTen(Barber barber) {
        Appointment appointment = new Appointment("Busy", "busy-" + barber.getId() + "@taskflow.test", "555",
                barber.getName(), MONDAY, "10:00", "Classic Haircut");
        appointment.setBarber(barber);
        appointmentRepository.save(appointment);
    }
}
