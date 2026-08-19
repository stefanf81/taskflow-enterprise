package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class BarberServiceImplTest {

    @Mock
    private BarberRepository barberRepository;

    @Mock
    private BarberScheduleRepository scheduleRepository;

    @Mock
    private BarberTimeOffRepository timeOffRepository;

    @Mock
    private AppointmentStatsService statsService;

    private BarberServiceImpl barberService;

    @BeforeEach
    void setUp() {
        barberService = new BarberServiceImpl(barberRepository, scheduleRepository, timeOffRepository, statsService);
    }

    @Test
    void getPublicBarbers_shouldReturnOnlyPublicFields() {
        PublicBarberResponse projected = new PublicBarberResponse(1L, "Alex");
        when(barberRepository.findAllPublicProjectedBy()).thenReturn(List.of(projected));

        List<PublicBarberResponse> result = barberService.getPublicBarbers();

        assertEquals(List.of(projected), result);
    }

    @Test
    void getAllBarbers_shouldReturnList() {
        BarberResponse projected = new BarberResponse(1L, "Alex", "alex@test.com", "555-1234");
        when(barberRepository.findAllProjectedBy()).thenReturn(List.of(projected));

        List<BarberResponse> result = barberService.getAllBarbers();

        assertEquals(1, result.size());
        assertEquals("Alex", result.get(0).name());
    }

    @Test
    void createBarber_shouldPersistAndReturn() {
        BarberRequest request = new BarberRequest("Alex", "alex@test.com", "555-1234");
        Barber saved = new Barber();
        saved.setId(1L);
        saved.setName("Alex");
        saved.setEmail("alex@test.com");
        saved.setPhone("555-1234");
        when(barberRepository.save(any(Barber.class))).thenReturn(saved);

        BarberResponse result = barberService.createBarber(request);

        assertEquals("Alex", result.name());
    }

    @Test
    void getTimeOff_shouldReturnList() {
        BarberTimeOff timeOff = new BarberTimeOff();
        timeOff.setId(1L);
        timeOff.setStartDate(LocalDate.of(2026, 7, 22));
        timeOff.setEndDate(LocalDate.of(2026, 7, 23));
        when(timeOffRepository.findByBarberId(1L)).thenReturn(List.of(timeOff));

        List<BarberTimeOffResponse> result = barberService.getTimeOff(1L);

        assertEquals(1, result.size());
        assertEquals(LocalDate.of(2026, 7, 22), result.get(0).startDate());
    }

    @Test
    void addTimeOff_shouldCreateAndReturn() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex the Barber");
        when(barberRepository.findById(1L)).thenReturn(Optional.of(barber));

        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 22), LocalDate.of(2026, 7, 23), "Vacation");
        BarberTimeOff saved = new BarberTimeOff();
        saved.setId(1L);
        saved.setStartDate(LocalDate.of(2026, 7, 22));
        saved.setEndDate(LocalDate.of(2026, 7, 23));
        saved.setReason("Vacation");
        when(timeOffRepository.save(any(BarberTimeOff.class))).thenReturn(saved);

        BarberTimeOffResponse result = barberService.addTimeOff(1L, request);

        assertNotNull(result);
        assertEquals(LocalDate.of(2026, 7, 22), result.startDate());
        // Cache evicted for each date in the range (2 days: 7/22 and 7/23).
        verify(statsService).clearBusySlotsCache("Alex the Barber", LocalDate.of(2026, 7, 22));
        verify(statsService).clearBusySlotsCache("Alex the Barber", LocalDate.of(2026, 7, 23));
    }

    @Test
    void addTimeOff_shouldThrowWhenBarberNotFound() {
        when(barberRepository.findById(99L)).thenReturn(Optional.empty());

        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 22), LocalDate.of(2026, 7, 23), "Vacation");

        assertThrows(ResourceNotFoundException.class, () -> barberService.addTimeOff(99L, request));
    }

    @Test
    void addTimeOff_shouldThrowWhenDateRangeInvalid() {
        Barber barber = new Barber();
        barber.setId(1L);
        when(barberRepository.findById(1L)).thenReturn(Optional.of(barber));

        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 25), LocalDate.of(2026, 7, 22), "Bad range");

        assertThrows(IllegalArgumentException.class, () -> barberService.addTimeOff(1L, request));
    }
}
