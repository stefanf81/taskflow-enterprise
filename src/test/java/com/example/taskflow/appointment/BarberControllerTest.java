package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class BarberControllerTest {

    @Mock
    private BarberService barberService;

    private BarberController barberController;

    @BeforeEach
    void setUp() {
        barberController = new BarberController(barberService);
    }

    @Test
    void getAllBarbers_shouldReturnList() {
        BarberResponse projected = new BarberResponse(1L, "Alex", "alex@test.com", "555-1234");
        when(barberService.getAllBarbers()).thenReturn(List.of(projected));

        ResponseEntity<List<BarberResponse>> result = barberController.getAllBarbers();

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals(1, result.getBody().size());
        assertEquals("Alex", result.getBody().get(0).name());
    }

    @Test
    void createBarber_shouldPersistAndReturn() {
        BarberRequest request = new BarberRequest("Alex", "alex@test.com", "555-1234");
        Barber saved = new Barber();
        saved.setId(1L);
        saved.setName("Alex");
        when(barberService.createBarber(any(BarberRequest.class))).thenReturn(saved);

        ResponseEntity<Barber> result = barberController.createBarber(request);

        assertEquals(HttpStatus.CREATED, result.getStatusCode());
        assertEquals("Alex", result.getBody().getName());
    }

    @Test
    void getTimeOff_shouldReturnList() {
        BarberTimeOff timeOff = new BarberTimeOff();
        timeOff.setId(1L);
        when(barberService.getTimeOff(1L)).thenReturn(List.of(timeOff));

        ResponseEntity<List<BarberTimeOff>> result = barberController.getTimeOff(1L);

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals(1, result.getBody().size());
    }

    @Test
    void addTimeOff_shouldCreateAndReturn() {
        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 22), LocalDate.of(2026, 7, 23), "Vacation");
        BarberTimeOff saved = new BarberTimeOff();
        saved.setId(1L);
        saved.setStartDate(LocalDate.of(2026, 7, 22));
        saved.setEndDate(LocalDate.of(2026, 7, 23));
        when(barberService.addTimeOff(eq(1L), any(BarberTimeOffRequest.class))).thenReturn(saved);

        ResponseEntity<BarberTimeOff> result = barberController.addTimeOff(1L, request);

        assertEquals(HttpStatus.CREATED, result.getStatusCode());
        assertNotNull(result.getBody());
    }

    @Test
    void addTimeOff_shouldThrowWhenBarberNotFound() {
        when(barberService.addTimeOff(eq(99L), any(BarberTimeOffRequest.class)))
                .thenThrow(new ResourceNotFoundException("Barber not found with id: 99"));

        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 22), LocalDate.of(2026, 7, 23), "Vacation");

        assertThrows(ResourceNotFoundException.class, () -> barberController.addTimeOff(99L, request));
    }
}
