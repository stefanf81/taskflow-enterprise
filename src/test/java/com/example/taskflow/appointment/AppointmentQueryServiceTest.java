package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
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
    void testGetAllAppointments_StatusViewsCountTheirOwnRowsRatherThanTrustTheCache() {
        // The counters are stale (a dropped eviction, a Redis error: the caches fail open) and say
        // 12 pending where there are 34. The pager divides the TOTAL into pages, so a total that
        // does not match the rows the query returns hides rows behind a page count that is too low.
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(40L, 12L, 20L, 8L, 3L, 0, 0.0));
        when(appointmentRepository.findByStatus(eq(AppointmentStatus.PENDING), any(Pageable.class)))
                .thenReturn(new SliceImpl<>(fullPageOfTen(), PageRequest.of(0, 10), true));
        when(appointmentRepository.countByStatus(AppointmentStatus.PENDING)).thenReturn(34L);
        when(appointmentRepository.findByStatusAndBookingDateBefore(any(), any(), any(Pageable.class)))
                .thenReturn(new SliceImpl<>(fullPageOfTen(), PageRequest.of(0, 10), true));
        when(appointmentRepository.countByStatusAndBookingDateBefore(
                eq(AppointmentStatus.PENDING), eq(LocalDate.now(CLOCK)))).thenReturn(17L);

        assertEquals(34, queryService.getAllAppointments("pending", null, 0, 10).page().getTotalElements());
        assertEquals(4, queryService.getAllAppointments("pending", null, 0, 10).page().getTotalPages());
        assertEquals(17, queryService.getAllAppointments("OVERDUE", null, 0, 10).page().getTotalElements());

        // Still no Specification/COUNT(*) pair: the count is the status index's own.
        verify(appointmentRepository, never()).findAll(any(Specification.class), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_CancelledRowsAreCountedNotDerivedFromTheOtherCounters() {
        // Cancelled rows used to be "every row minus the non-cancelled ones", from two separately
        // cached values that could not be read as one consistent pair.
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(10L, 10L, 0L, 0L, 0L, 0, 0.0));
        when(appointmentRepository.findByStatus(eq(AppointmentStatus.CANCELLED), any(Pageable.class)))
                .thenReturn(new SliceImpl<>(fullPageOfTen(), PageRequest.of(0, 10), true));
        when(appointmentRepository.countByStatus(AppointmentStatus.CANCELLED)).thenReturn(12L);

        assertEquals(12, queryService.getAllAppointments("CANCELLED", null, 0, 10).page().getTotalElements());
        verify(statsService, never()).getTotalCountCached();
    }

    @Test
    void testGetAllAppointments_AStatusPageThatSettlesItsOwnTotalRunsNoCountQuery() {
        // A first page the rows do not fill is the whole result: counting it again would be waste.
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(40L, 12L, 20L, 8L, 3L, 0, 0.0));
        when(appointmentRepository.findByStatus(eq(AppointmentStatus.PENDING), any(Pageable.class)))
                .thenReturn(new SliceImpl<>(List.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00")),
                        PageRequest.of(0, 10), false));

        assertEquals(1, queryService.getAllAppointments("PENDING", null, 0, 10).page().getTotalElements());
        verify(appointmentRepository, never()).countByStatus(any());
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
    void testGetAllAppointments_SliceHasNextRaisesUnderstatedCachedTotal() {
        // The unfiltered view is the whole table, so it keeps the cached row count — with the
        // slice's own floor, so a stale count can never swallow the page that follows.
        when(statsService.getStatsCached()).thenReturn(new AppointmentStats(10L, 10L, 0L, 0L, 0L, 0, 0.0));
        when(statsService.getTotalCountCached()).thenReturn(10L);
        when(appointmentRepository.findPageWithoutCount(any(Pageable.class)))
                .thenReturn(new SliceImpl<>(fullPageOfTen(), PageRequest.of(0, 10), true));

        AppointmentDashboardResponse response = queryService.getAllAppointments(null, null, 0, 10);

        assertEquals(11, response.page().getTotalElements());
        assertEquals(2, response.page().getTotalPages());
        assertTrue(response.page().hasNext());
    }

    /** Ten rows: a page that a size of 10 fills exactly, so a total has to come from somewhere. */
    private List<Appointment> fullPageOfTen() {
        return java.util.stream.IntStream.rangeClosed(1, 10)
                .mapToObj(id -> appointment(id, AppointmentStatus.PENDING, TOMORROW, "10:00"))
                .toList();
    }

    @Test
    void testPaginationRejectsNegativeBoundsAndIntegerOffsetOverflow() {
        assertThrows(IllegalArgumentException.class,
                () -> queryService.getAllAppointments(null, null, -1, 10));
        assertThrows(IllegalArgumentException.class,
                () -> queryService.getAllAppointments(null, null, 0, 0));
        assertThrows(IllegalArgumentException.class,
                () -> queryService.getAllAppointments(null, null, 21_474_837, 100));
        assertThrows(IllegalArgumentException.class,
                () -> queryService.getMyAppointments("john@test.com", 21_474_837, 100));
        verifyNoInteractions(appointmentRepository, statsService);
    }

    @Test
    void testNullEntityToResponse() {
        assertNull(AppointmentResponse.fromEntity(null));
    }
}
