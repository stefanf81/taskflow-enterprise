package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.catalog.ServiceItem;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.QueryTimeoutException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class BusySlotsServiceTest {

    @Mock
    private BarberRepository barberRepository;

    @Mock
    private BarberScheduleRepository barberScheduleRepository;

    @Mock
    private BarberTimeOffRepository barberTimeOffRepository;

    @Mock
    private AppointmentRepository appointmentRepository;

    private BusySlotsService busySlotsService;

    private static final LocalDate TEST_DATE = LocalDate.of(2026, 7, 21);
    private static final String TEST_BARBER = "Alex";
    private static final String TEST_DATE_STR = "2026-07-21";

    @BeforeEach
    void setUp() {
        busySlotsService = new BusySlotsService(
                barberRepository, barberScheduleRepository,
                barberTimeOffRepository, appointmentRepository);
    }

    private static Barber barber(long id, String name) {
        Barber barber = new Barber();
        barber.setId(id);
        barber.setName(name);
        return barber;
    }

    private static BarberSchedule schedule(int startHour, int endHour) {
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(LocalTime.of(startHour, 0));
        schedule.setEndTime(LocalTime.of(endHour, 0));
        return schedule;
    }

    /** An active appointment with a service of the given length (null = legacy row without a service). */
    private static Appointment appointment(long id, String barberName, String time, Integer durationMinutes) {
        Appointment appointment = new Appointment("C", "c@test.com", "1", barberName, TEST_DATE, time, "Svc");
        appointment.setId(id);
        if (durationMinutes != null) {
            appointment.setService(new ServiceItem("Svc", BigDecimal.TEN, durationMinutes, "hair", ""));
        }
        return appointment;
    }

    private void stubWorkingBarber(Barber barber, BarberSchedule schedule) {
        lenient().when(barberRepository.findByName(barber.getName())).thenReturn(Optional.of(barber));
        lenient().when(barberTimeOffRepository.findTimeOffForBarberOnDate(eq(barber.getId()), eq(TEST_DATE)))
                .thenReturn(Collections.emptyList());
        lenient().when(barberScheduleRepository.findByBarberIdAndDayOfWeek(
                        eq(barber.getId()), eq(TEST_DATE.getDayOfWeek().getValue())))
                .thenReturn(Optional.of(schedule));
    }

    @Test
    void getBusySlots_shouldReturnAllSlotsWhenBarberHasTimeOff() {
        Barber barber = barber(1L, TEST_BARBER);
        when(barberRepository.findByName(TEST_BARBER)).thenReturn(Optional.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(eq(1L), eq(TEST_DATE)))
                .thenReturn(List.of(new BarberTimeOff()));

        List<String> slots = busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR);

        assertEquals(List.of("09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"), slots);
        verify(appointmentRepository, never()).findActiveForBarberOnDate(any(), any());
    }

    @Test
    void getBusySlots_shouldReturnAllSlotsWhenBarberNotScheduled() {
        Barber barber = barber(1L, TEST_BARBER);
        when(barberRepository.findByName(TEST_BARBER)).thenReturn(Optional.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(eq(1L), eq(TEST_DATE)))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(eq(1L), eq(TEST_DATE.getDayOfWeek().getValue())))
                .thenReturn(Optional.empty());

        assertEquals(BusySlotsService.ALL_SLOTS, busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_shouldReturnBusyTimesWhenBarberScheduled() {
        stubWorkingBarber(barber(1L, TEST_BARBER), schedule(9, 17));
        when(appointmentRepository.findActiveForBarberOnDate(TEST_BARBER, TEST_DATE))
                .thenReturn(List.of(appointment(1, TEST_BARBER, "10:00", 30), appointment(2, TEST_BARBER, "14:00", 60)));

        assertEquals(List.of("10:00", "14:00"), busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_shouldReturnEmptyWhenNoAppointments() {
        stubWorkingBarber(barber(1L, TEST_BARBER), schedule(9, 17));
        when(appointmentRepository.findActiveForBarberOnDate(TEST_BARBER, TEST_DATE))
                .thenReturn(Collections.emptyList());

        assertTrue(busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR).isEmpty());
    }

    /** BKG-1: a long appointment also makes the slots it covers busy. */
    @Test
    void getBusySlots_slotsCoveredByALongerAppointmentAreBusy() {
        stubWorkingBarber(barber(1L, TEST_BARBER), schedule(9, 17));
        // 10:00 + 150 min covers 10:00, 11:00 and 12:00 (not a grid slot); 13:00 is free
        when(appointmentRepository.findActiveForBarberOnDate(TEST_BARBER, TEST_DATE))
                .thenReturn(List.of(appointment(1, TEST_BARBER, "10:00", 150)));

        assertEquals(List.of("10:00", "11:00"), busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_adjacentShortAppointmentDoesNotBlockNextSlot() {
        stubWorkingBarber(barber(1L, TEST_BARBER), schedule(9, 17));
        when(appointmentRepository.findActiveForBarberOnDate(TEST_BARBER, TEST_DATE))
                .thenReturn(List.of(appointment(1, TEST_BARBER, "10:00", 60)));

        assertEquals(List.of("10:00"), busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_legacyAppointmentWithoutServiceStillBlocksItsSlot() {
        stubWorkingBarber(barber(1L, TEST_BARBER), schedule(9, 17));
        when(appointmentRepository.findActiveForBarberOnDate(TEST_BARBER, TEST_DATE))
                .thenReturn(List.of(appointment(1, TEST_BARBER, "13:00", null)));

        assertEquals(List.of("13:00"), busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_slotsOutsideTheWorkingWindowAreBusy() {
        stubWorkingBarber(barber(1L, TEST_BARBER), schedule(10, 14));
        when(appointmentRepository.findActiveForBarberOnDate(TEST_BARBER, TEST_DATE))
                .thenReturn(Collections.emptyList());

        assertEquals(List.of("09:00", "14:00", "15:00", "16:00"),
                busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR));
    }

    // ── BKG-9: unknown barber / malformed date are 400s, never a (cacheable) answer ─────────

    @Test
    void getBusySlots_unknownBarber_isRejected() {
        when(barberRepository.findByName("Unknown")).thenReturn(Optional.empty());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> busySlotsService.getBusySlots("Unknown", TEST_DATE_STR));
        assertTrue(ex.getMessage().contains("Unknown barber"));
        verifyNoInteractions(appointmentRepository);
    }

    @Test
    void getBusySlots_malformedOrBlankDate_isRejected() {
        for (String bad : new String[] {"not-a-date", "2026-13-45", "", "  ", null, "123"}) {
            assertThrows(IllegalArgumentException.class,
                    () -> busySlotsService.getBusySlots(TEST_BARBER, bad), "date: " + bad);
        }
    }

    // ── BKG-4: infrastructure failures propagate (so nothing is cached) ─────────────────────

    @Test
    void getBusySlots_databaseFailurePropagatesInsteadOfReturningAllSlotsBusy() {
        stubWorkingBarber(barber(1L, TEST_BARBER), schedule(9, 17));
        when(appointmentRepository.findActiveForBarberOnDate(TEST_BARBER, TEST_DATE))
                .thenThrow(new QueryTimeoutException("timeout"));

        assertThrows(QueryTimeoutException.class, () -> busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_noPreference_databaseFailurePropagates() {
        when(barberRepository.findAll()).thenThrow(new QueryTimeoutException("timeout"));

        assertThrows(QueryTimeoutException.class, () -> busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR));
    }

    // ── H3: "No Preference" sentinel tests ──────────────────────────────────

    @Test
    void getBusySlots_noPreference_noBarbersExists_returnsAllSlots() {
        when(barberRepository.findAll()).thenReturn(Collections.emptyList());

        assertEquals(BusySlotsService.ALL_SLOTS, busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_noPreference_allBarbersBookedAtSlot_returnsThatSlotBusy() {
        Barber barber = barber(1L, "Alex");
        stubWorkingBarber(barber, schedule(9, 17));
        when(barberRepository.findAll()).thenReturn(List.of(barber));
        when(appointmentRepository.findActiveOnDate(TEST_DATE)).thenReturn(
                BusySlotsService.ALL_SLOTS.stream().map(t -> appointment(1, "Alex", t, 30)).toList());

        assertEquals(BusySlotsService.ALL_SLOTS, busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_noPreference_atLeastOneBarberFree_returnsSlotAvailable() {
        Barber alex = barber(1L, "Alex");
        Barber sara = barber(2L, "Sara");
        stubWorkingBarber(alex, schedule(9, 17));
        stubWorkingBarber(sara, schedule(9, 17));
        when(barberRepository.findAll()).thenReturn(List.of(alex, sara));
        // Alex is booked at 10:00 and 11:00, Sara only at 10:00 -> only 10:00 is busy for everyone
        when(appointmentRepository.findActiveOnDate(TEST_DATE)).thenReturn(List.of(
                appointment(1, "Alex", "10:00", 30), appointment(2, "Alex", "11:00", 30),
                appointment(3, "Sara", "10:00", 30)));

        assertEquals(List.of("10:00"), busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_noPreference_barberOnTimeOff_returnsAllSlots() {
        Barber barber = barber(1L, "Alex");
        when(barberRepository.findAll()).thenReturn(List.of(barber));
        when(appointmentRepository.findActiveOnDate(TEST_DATE)).thenReturn(Collections.emptyList());
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(1L, TEST_DATE))
                .thenReturn(List.of(new BarberTimeOff()));

        assertEquals(BusySlotsService.ALL_SLOTS, busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR));
    }

    @Test
    void getBusySlots_noPreference_respectsBarberWorkingWindow() {
        Barber barber = barber(1L, "Alex");
        stubWorkingBarber(barber, schedule(10, 14));
        when(barberRepository.findAll()).thenReturn(List.of(barber));
        when(appointmentRepository.findActiveOnDate(TEST_DATE)).thenReturn(Collections.emptyList());

        // Window is [10:00, 14:00): only 10:00, 11:00 and 13:00 are offerable.
        assertEquals(List.of("09:00", "14:00", "15:00", "16:00"), busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR));
    }

    // ── findConflict: the single rule set behind create / approve / no-preference ───────────

    @Test
    void findConflict_freeSlotInsideWindow_hasNoConflict() {
        Barber barber = barber(1L, "Alex");
        stubWorkingBarber(barber, schedule(9, 17));
        when(appointmentRepository.findActiveForBarberOnDate("Alex", TEST_DATE)).thenReturn(List.of());

        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(10, 0), 60, null).isEmpty());
    }

    @Test
    void findConflict_serviceRunningPastClosingTime_isRejected() {
        Barber barber = barber(1L, "Alex");
        stubWorkingBarber(barber, schedule(9, 17));
        lenient().when(appointmentRepository.findActiveForBarberOnDate("Alex", TEST_DATE)).thenReturn(List.of());

        // 16:00 + 60 = 17:00 fits exactly; 16:00 + 61 does not
        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(16, 0), 60, null).isEmpty());
        Optional<String> conflict = busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(16, 0), 61, null);
        assertTrue(conflict.isPresent());
        assertTrue(conflict.get().contains("closing time"));
    }

    @Test
    void findConflict_overlapWithLongerExistingAppointmentIsRejected() {
        Barber barber = barber(1L, "Alex");
        stubWorkingBarber(barber, schedule(9, 17));
        // existing 10:00-12:00 (120 min)
        when(appointmentRepository.findActiveForBarberOnDate("Alex", TEST_DATE))
                .thenReturn(List.of(appointment(5, "Alex", "10:00", 120)));

        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(11, 0), 30, null).isPresent());
        // 09:00 + 90 min runs into the 10:00 appointment, 09:00 + 60 ends exactly when it starts
        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(9, 0), 90, null).isPresent());
        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(9, 0), 60, null).isEmpty());
        // 13:00 is after it
        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(13, 0), 60, null).isEmpty());
    }

    @Test
    void findConflict_excludesTheAppointmentBeingRevalidated() {
        Barber barber = barber(1L, "Alex");
        stubWorkingBarber(barber, schedule(9, 17));
        when(appointmentRepository.findActiveForBarberOnDate("Alex", TEST_DATE))
                .thenReturn(List.of(appointment(5, "Alex", "10:00", 60)));

        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(10, 0), 60, null).isPresent());
        assertTrue(busySlotsService.findConflict(barber, TEST_DATE, LocalTime.of(10, 0), 60, 5L).isEmpty());
    }

    @Test
    void findConflict_timeOffAndUnscheduledAndOutsideWindow() {
        Barber onLeave = barber(1L, "Leave");
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(1L, TEST_DATE)).thenReturn(List.of(new BarberTimeOff()));
        assertTrue(busySlotsService.findConflict(onLeave, TEST_DATE, LocalTime.of(10, 0), 30, null)
                .orElseThrow().contains("time off"));

        Barber off = barber(2L, "Off");
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(2L, TEST_DATE)).thenReturn(List.of());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(2L, TEST_DATE.getDayOfWeek().getValue()))
                .thenReturn(Optional.empty());
        assertTrue(busySlotsService.findConflict(off, TEST_DATE, LocalTime.of(10, 0), 30, null)
                .orElseThrow().contains("not scheduled"));

        Barber half = barber(3L, "Half");
        stubWorkingBarber(half, schedule(9, 12));
        assertTrue(busySlotsService.findConflict(half, TEST_DATE, LocalTime.of(13, 0), 30, null)
                .orElseThrow().contains("working hours"));
    }

    @Test
    void isGridSlot_acceptsOnlyTheHourlyGrid() {
        for (String slot : BusySlotsService.ALL_SLOTS) {
            assertTrue(BusySlotsService.isGridSlot(slot));
        }
        for (String bad : new String[] {"10:30", "10:01", "12:00", "08:00", "17:00", "", null, "10:00:00"}) {
            assertFalse(BusySlotsService.isGridSlot(bad), "slot: " + bad);
        }
    }

    // ── findFirstAvailableBarber: same rules per candidate ──────────────────────────────────

    @Test
    void findFirstAvailableBarber_respectsWindowAndBookings() {
        Barber early = barber(1L, "Early");
        Barber late = barber(2L, "Late");
        stubWorkingBarber(early, schedule(9, 11));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(2L, TEST_DATE)).thenReturn(List.of(new BarberTimeOff()));
        when(barberRepository.findAll()).thenReturn(List.of(early, late));
        when(appointmentRepository.findActiveOnDate(TEST_DATE)).thenReturn(List.of());

        Optional<Barber> resolved = busySlotsService.findFirstAvailableBarber(TEST_DATE, "10:00", 30);
        assertTrue(resolved.isPresent());
        assertEquals("Early", resolved.get().getName());

        // 15:00 is outside Early's window; Late is off -> nobody available.
        assertTrue(busySlotsService.findFirstAvailableBarber(TEST_DATE, "15:00", 30).isEmpty());
    }

    /** BKG-1: a busy barber must not be assigned for a "No Preference" booking. */
    @Test
    void findFirstAvailableBarber_skipsBarbersWhoseExistingAppointmentOverlaps() {
        Barber alex = barber(1L, "Alex");
        Barber sara = barber(2L, "Sara");
        stubWorkingBarber(alex, schedule(9, 17));
        stubWorkingBarber(sara, schedule(9, 17));
        when(barberRepository.findAll()).thenReturn(List.of(alex, sara));
        // Alex has a 2-hour appointment from 10:00; Sara is free
        when(appointmentRepository.findActiveOnDate(TEST_DATE))
                .thenReturn(List.of(appointment(1, "Alex", "10:00", 120)));

        assertEquals("Sara", busySlotsService.findFirstAvailableBarber(TEST_DATE, "11:00", 30).orElseThrow().getName());
        assertEquals("Alex", busySlotsService.findFirstAvailableBarber(TEST_DATE, "13:00", 30).orElseThrow().getName());
    }

    @Test
    void findFirstAvailableBarber_appliesServiceLengthAgainstClosingTime() {
        Barber early = barber(1L, "Short");
        Barber full = barber(2L, "Full");
        stubWorkingBarber(early, schedule(9, 16));
        stubWorkingBarber(full, schedule(9, 17));
        when(barberRepository.findAll()).thenReturn(List.of(early, full));
        when(appointmentRepository.findActiveOnDate(TEST_DATE)).thenReturn(List.of());

        // 15:00 + 60 ends at 16:00: fits Short's shift
        assertEquals("Short", busySlotsService.findFirstAvailableBarber(TEST_DATE, "15:00", 60).orElseThrow().getName());
        // 15:00 + 90 overruns Short's closing time, so Full gets it
        assertEquals("Full", busySlotsService.findFirstAvailableBarber(TEST_DATE, "15:00", 90).orElseThrow().getName());
    }

    @Test
    void findFirstAvailableBarber_databaseFailurePropagates() {
        when(barberRepository.findAll()).thenThrow(new QueryTimeoutException("timeout"));

        assertThrows(QueryTimeoutException.class,
                () -> busySlotsService.findFirstAvailableBarber(TEST_DATE, "10:00", 30));
    }
}
