package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.SliceImpl;
import org.springframework.data.jpa.domain.Specification;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** {@link AppointmentQueryService}: the admin dashboard listing, single lookup and response mapping. */
class AppointmentQueryServiceTest extends AppointmentServiceTestSupport {

    @Test
    void testGetAllAppointments_NoFilters() {
        when(appointmentRepository.findPageWithoutCount(any(Pageable.class))).thenReturn(
                new SliceImpl<>(List.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00"))));
        when(statsService.getTotalCountCached()).thenReturn(31L);
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(1L, 1L, 0L, 0L, 0L, 0, 0.0));

        AppointmentDashboardResponse response = queryService.getAllAppointments(null, null, 0, 10);

        // the total comes from the cached count, not from a COUNT(*) per request
        assertEquals(31, response.page().getTotalElements());
        assertEquals(4, response.page().getTotalPages());
        verify(appointmentRepository, never()).findAll(any(Pageable.class));
        assertEquals("John Doe", response.page().getContent().get(0).customerName());
        assertEquals(1L, response.stats().total());
    }

    @Test
    void testGetAllAppointments_BlankFiltersMeanNoFilter() {
        when(appointmentRepository.findPageWithoutCount(any(Pageable.class))).thenReturn(new SliceImpl<>(List.of()));
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(4L, 2L, 1L, 1L, 0L, 0, 25.0));

        AppointmentDashboardResponse response = queryService.getAllAppointments("", "  ", 0, 10);

        assertEquals(25, response.stats().progress());
        verify(appointmentRepository, never()).findAll(any(Specification.class), any(Pageable.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void testGetAllAppointments_SearchUsesASpecificationWithItsCount() {
        when(appointmentRepository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(0L, 0L, 0L, 0L, 0L, 0, 0.0));

        queryService.getAllAppointments("PENDING", "John", 0, 10);
        queryService.getAllAppointments(null, "john@test.com", 0, 10);
        queryService.getAllAppointments("OVERDUE", "john", 0, 10);

        verify(appointmentRepository, times(3)).findAll(any(Specification.class), any(Pageable.class));
        verify(appointmentRepository, never()).findPageWithoutCount(any(Pageable.class));
        verify(appointmentRepository, never()).findByStatus(any(), any(Pageable.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void testGetAllAppointments_StatusViewsTakeTheirTotalFromTheCachedStats() {
        // total (not cancelled) 40 = 12 pending + 20 approved + 8 denied; 3 pending are overdue
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(40L, 12L, 20L, 8L, 3L, 0, 0.0));
        when(statsService.getTotalCountCached()).thenReturn(55L);
        when(appointmentRepository.findByStatus(any(), any(Pageable.class))).thenReturn(new SliceImpl<>(List.of()));
        when(appointmentRepository.findByStatusAndBookingDateBefore(any(), any(), any(Pageable.class)))
                .thenReturn(new SliceImpl<>(List.of()));

        assertEquals(12, queryService.getAllAppointments("pending", null, 0, 10).page().getTotalElements());
        assertEquals(20, queryService.getAllAppointments("APPROVED", null, 0, 10).page().getTotalElements());
        assertEquals(8, queryService.getAllAppointments("DENIED", "  ", 0, 10).page().getTotalElements());
        assertEquals(15, queryService.getAllAppointments("CANCELLED", null, 0, 10).page().getTotalElements());
        assertEquals(3, queryService.getAllAppointments("OVERDUE", null, 0, 10).page().getTotalElements());

        verify(appointmentRepository).findByStatus(eq(AppointmentStatus.CANCELLED), any(Pageable.class));
        verify(appointmentRepository).findByStatusAndBookingDateBefore(
                eq(AppointmentStatus.PENDING), eq(LocalDate.now(CLOCK)), any(Pageable.class));
        // no COUNT query for any of them
        verify(appointmentRepository, never()).findAll(any(Specification.class), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_CancelledCountNeverGoesNegative() {
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(10L, 10L, 0L, 0L, 0L, 0, 0.0));
        when(statsService.getTotalCountCached()).thenReturn(9L);
        when(appointmentRepository.findByStatus(any(), any(Pageable.class))).thenReturn(new SliceImpl<>(List.of()));

        assertEquals(0, queryService.getAllAppointments("CANCELLED", null, 0, 10).page().getTotalElements());
    }

    @Test
    void testGetAllAppointments_NewestFirst() {
        when(appointmentRepository.findPageWithoutCount(any(Pageable.class))).thenReturn(new SliceImpl<>(List.of()));
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(0L, 0L, 0L, 0L, 0L, 0, 0.0));
        org.mockito.ArgumentCaptor<Pageable> pageable = org.mockito.ArgumentCaptor.forClass(Pageable.class);

        queryService.getAllAppointments(null, null, 2, 50);

        verify(appointmentRepository).findPageWithoutCount(pageable.capture());
        assertEquals(org.springframework.data.domain.Sort.by(
                org.springframework.data.domain.Sort.Order.desc("bookingDate"),
                org.springframework.data.domain.Sort.Order.desc("bookingTime"),
                org.springframework.data.domain.Sort.Order.desc("id")), pageable.getValue().getSort());
        assertEquals(100, pageable.getValue().getOffset());
    }

    @Test
    void testGetAllAppointments_UnknownStatusIsRejected() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> queryService.getAllAppointments("BOGUS", null, 0, 10));
        assertTrue(ex.getMessage().contains("Unknown status"));
        verifyNoInteractions(statsService);
    }

    @Test
    void testGetAppointmentById() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        assertEquals(1L, queryService.getAppointmentById(1L).id());
        when(appointmentRepository.findById(2L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> queryService.getAppointmentById(2L));
    }

    @Test
    void testNullEntityToResponse() {
        assertNull(AppointmentResponse.fromEntity(null));
    }
}
