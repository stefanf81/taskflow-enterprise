package com.example.taskflow.appointment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;

import java.time.LocalDate;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CustomerControllerTest {

    @Mock
    private AppointmentService appointmentService;

    @Mock
    private Authentication authentication;

    private CustomerController customerController;

    @BeforeEach
    void setUp() {
        customerController = new CustomerController(appointmentService);
    }

    @Test
    void getMyAppointments_shouldReturnPage() {
        when(authentication.getName()).thenReturn("user@test.com");
        Page<AppointmentResponse> page = new PageImpl<>(Collections.emptyList());
        when(appointmentService.getMyAppointments(eq("user@test.com"), eq(0), eq(10)))
                .thenReturn(page);

        ResponseEntity<Page<AppointmentResponse>> result =
                customerController.getMyAppointments(authentication, 0, 10);

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertTrue(result.getBody().isEmpty());
    }

    @Test
    void cancelMyAppointment_shouldSucceed() {
        when(authentication.getName()).thenReturn("user@test.com");
        doNothing().when(appointmentService).cancelMyAppointment(1L, "user@test.com");

        ResponseEntity<Void> result = customerController.cancelMyAppointment(1L, authentication);

        assertEquals(HttpStatus.NO_CONTENT, result.getStatusCode());
    }
}
