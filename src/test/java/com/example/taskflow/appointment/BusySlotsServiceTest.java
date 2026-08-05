package com.example.taskflow.appointment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
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

    @Test
    void getBusySlots_shouldReturnAllSlotsWhenBarberHasTimeOff() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName(TEST_BARBER);
        when(barberRepository.findByName(TEST_BARBER)).thenReturn(Optional.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(eq(1L), eq(TEST_DATE)))
                .thenReturn(List.of(new BarberTimeOff()));

        List<String> slots = busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR);

        List<String> expectedSlots = List.of("09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00");
        assertEquals(expectedSlots, slots);
        verify(appointmentRepository, never()).findDistinctBookingTimes(any(), any(), any());
    }

    @Test
    void getBusySlots_shouldReturnAllSlotsWhenBarberNotScheduled() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName(TEST_BARBER);
        when(barberRepository.findByName(TEST_BARBER)).thenReturn(Optional.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(eq(1L), eq(TEST_DATE)))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(eq(1L), eq(TEST_DATE.getDayOfWeek().getValue())))
                .thenReturn(Optional.empty());

        List<String> slots = busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR);

        List<String> expectedSlots = List.of("09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00");
        assertEquals(expectedSlots, slots);
    }

    @Test
    void getBusySlots_shouldReturnBusyTimesWhenBarberScheduled() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName(TEST_BARBER);
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(java.time.LocalTime.of(9, 0));
        schedule.setEndTime(java.time.LocalTime.of(17, 0));

        when(barberRepository.findByName(TEST_BARBER)).thenReturn(Optional.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(eq(1L), eq(TEST_DATE)))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(eq(1L), eq(TEST_DATE.getDayOfWeek().getValue())))
                .thenReturn(Optional.of(schedule));
        when(appointmentRepository.findDistinctBookingTimes(eq(TEST_BARBER), eq(TEST_DATE), eq(AppointmentStatus.DENIED)))
                .thenReturn(List.of("10:00", "14:00"));

        List<String> slots = busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR);

        assertEquals(List.of("10:00", "14:00"), slots);
    }

    @Test
    void getBusySlots_shouldHandleUnknownBarberGracefully() {
        when(barberRepository.findByName("Unknown")).thenReturn(Optional.empty());

        when(appointmentRepository.findDistinctBookingTimes(eq("Unknown"), any(LocalDate.class), eq(AppointmentStatus.DENIED)))
                .thenReturn(Collections.emptyList());

        List<String> slots = busySlotsService.getBusySlots("Unknown", TEST_DATE_STR);

        assertTrue(slots.isEmpty());
    }

    @Test
    void getBusySlots_shouldReturnEmptyOnInvalidDate() {
        List<String> slots = busySlotsService.getBusySlots(TEST_BARBER, "not-a-date");

        assertTrue(slots.isEmpty());
    }

    @Test
    void getBusySlots_shouldReturnEmptyWhenNoAppointments() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName(TEST_BARBER);
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(java.time.LocalTime.of(9, 0));
        schedule.setEndTime(java.time.LocalTime.of(17, 0));

        when(barberRepository.findByName(TEST_BARBER)).thenReturn(Optional.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(eq(1L), eq(TEST_DATE)))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(eq(1L), eq(TEST_DATE.getDayOfWeek().getValue())))
                .thenReturn(Optional.of(schedule));
        when(appointmentRepository.findDistinctBookingTimes(eq(TEST_BARBER), eq(TEST_DATE), eq(AppointmentStatus.DENIED)))
                .thenReturn(Collections.emptyList());

        List<String> slots = busySlotsService.getBusySlots(TEST_BARBER, TEST_DATE_STR);

        assertTrue(slots.isEmpty());
    }

    // ── H3: "No Preference" sentinel tests ──────────────────────────────────

    @Test
    void getBusySlots_noPreference_noBarbersExists_returnsAllSlots() {
        when(barberRepository.findAll()).thenReturn(Collections.emptyList());

        List<String> slots = busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR);

        assertEquals(BusySlotsService.ALL_SLOTS, slots);
    }

    @Test
    void getBusySlots_noPreference_allBarbersBookedAtSlot_returnsThatSlotBusy() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex");
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(java.time.LocalTime.of(9, 0));
        schedule.setEndTime(java.time.LocalTime.of(17, 0));

        when(barberRepository.findAll()).thenReturn(List.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(1L, TEST_DATE))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(1L, TEST_DATE.getDayOfWeek().getValue()))
                .thenReturn(Optional.of(schedule));
        // Every slot is booked
        when(appointmentRepository.findDistinctBookingTimes("Alex", TEST_DATE, AppointmentStatus.DENIED))
                .thenReturn(BusySlotsService.ALL_SLOTS);

        List<String> slots = busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR);

        assertEquals(BusySlotsService.ALL_SLOTS, slots);
    }

    @Test
    void getBusySlots_noPreference_atLeastOneBarberFree_returnsSlotAvailable() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex");
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(java.time.LocalTime.of(9, 0));
        schedule.setEndTime(java.time.LocalTime.of(17, 0));

        when(barberRepository.findAll()).thenReturn(List.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(1L, TEST_DATE))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(1L, TEST_DATE.getDayOfWeek().getValue()))
                .thenReturn(Optional.of(schedule));
        // Only 10:00 is booked → all other slots should be available
        when(appointmentRepository.findDistinctBookingTimes("Alex", TEST_DATE, AppointmentStatus.DENIED))
                .thenReturn(List.of("10:00"));

        List<String> slots = busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR);

        // Only "10:00" is busy because the single working barber is booked then
        assertEquals(List.of("10:00"), slots);
    }

    @Test
    void getBusySlots_noPreference_barberOnTimeOff_returnsAllSlots() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex");

        when(barberRepository.findAll()).thenReturn(List.of(barber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(1L, TEST_DATE))
                .thenReturn(List.of(new BarberTimeOff()));

        List<String> slots = busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, TEST_DATE_STR);

        assertEquals(BusySlotsService.ALL_SLOTS, slots);
    }
}
