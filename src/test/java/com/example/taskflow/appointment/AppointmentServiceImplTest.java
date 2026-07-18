package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AppointmentServiceImplTest {

    @Mock
    private AppointmentRepository appointmentRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    @Mock
    private CacheManager cacheManager;

    @Mock
    private Cache cache;

    @Mock
    private io.micrometer.tracing.Tracer tracer;

    @Mock
    private BarberRepository barberRepository;

    @Mock
    private com.example.taskflow.catalog.ServiceItemRepository serviceItemRepository;

    @Mock
    private BarberScheduleRepository barberScheduleRepository;

    @Mock
    private BarberTimeOffRepository barberTimeOffRepository;

    private BusySlotsService busySlotsService;

    private AppointmentServiceImpl appointmentService;

    private Appointment testAppointment;

    @BeforeEach
    void setUp() {
        busySlotsService = new BusySlotsService(barberRepository, barberScheduleRepository, barberTimeOffRepository, appointmentRepository);
        appointmentService = new AppointmentServiceImpl(
                appointmentRepository, eventPublisher, cacheManager, tracer,
                busySlotsService, barberRepository, barberScheduleRepository, serviceItemRepository
        );

        testAppointment = new Appointment("John Doe", "john@test.com", "1234567890", "Barber Alex", LocalDate.now(), "10:00", "Haircut");
        testAppointment.setId(1L);
        testAppointment.setPublicId("test-public-id");
        testAppointment.setStatus("PENDING");
    }

    @Test
    void testGetAllAppointments_NoFilters() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findAll(any(Pageable.class))).thenReturn(page);
        
        AppointmentStats stats = new AppointmentStats(1L, 1L, 0L, 0L, 0L, 0, 0.0);
        when(appointmentRepository.getAppointmentStats(any(LocalDate.class))).thenReturn(stats);

        AppointmentDashboardResponse response = appointmentService.getAllAppointments(null, null, 0, 10);

        assertNotNull(response);
        assertEquals(1, response.page().getTotalElements());
        assertEquals("John Doe", response.page().getContent().get(0).customerName());
        assertEquals(1L, response.stats().total());
        assertEquals(0, response.stats().progress());
    }

    @Test
    void testGetAllAppointments_WithProgressCalc() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findAll(any(Pageable.class))).thenReturn(page);
        
        // 1 approved out of 4 total -> 25%
        AppointmentStats stats = new AppointmentStats(4L, 2L, 1L, 1L, 0L, 0, 25.0);
        when(appointmentRepository.getAppointmentStats(any(LocalDate.class))).thenReturn(stats);

        AppointmentDashboardResponse response = appointmentService.getAllAppointments("", "", 0, 10);

        assertEquals(25, response.stats().progress());
        assertEquals(25.0, response.stats().approvedRevenue());
    }

    @Test
    void testGetAllAppointments_OverdueStatus() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByStatusAndBookingDateBefore(eq("PENDING"), any(LocalDate.class), any(Pageable.class))).thenReturn(page);
        when(appointmentRepository.getAppointmentStats(any(LocalDate.class))).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

        appointmentService.getAllAppointments("OVERDUE", null, 0, 10);

        verify(appointmentRepository).findByStatusAndBookingDateBefore(eq("PENDING"), any(LocalDate.class), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_StatusAndSearch() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByStatusAndCustomerNameContainingIgnoreCase(eq("PENDING"), eq("John"), any(Pageable.class))).thenReturn(page);
        when(appointmentRepository.getAppointmentStats(any(LocalDate.class))).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

        appointmentService.getAllAppointments("PENDING", "John", 0, 10);

        verify(appointmentRepository).findByStatusAndCustomerNameContainingIgnoreCase(eq("PENDING"), eq("John"), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_StatusOnly() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByStatus(eq("PENDING"), any(Pageable.class))).thenReturn(page);
        when(appointmentRepository.getAppointmentStats(any(LocalDate.class))).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

        appointmentService.getAllAppointments("PENDING", "  ", 0, 10);

        verify(appointmentRepository).findByStatus(eq("PENDING"), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_SearchOnly() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByCustomerNameContainingIgnoreCase(eq("John"), any(Pageable.class))).thenReturn(page);
        when(appointmentRepository.getAppointmentStats(any(LocalDate.class))).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

        appointmentService.getAllAppointments("   ", "John", 0, 10);

        verify(appointmentRepository).findByCustomerNameContainingIgnoreCase(eq("John"), any(Pageable.class));
    }

    @Test
    void testGetAppointmentById_Success() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(testAppointment));
        AppointmentResponse response = appointmentService.getAppointmentById(1L);
        assertNotNull(response);
        assertEquals(1L, response.id());
    }

    @Test
    void testGetAppointmentById_NotFound() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> appointmentService.getAppointmentById(1L));
    }

    @Test
    void testCreateAppointment() {
        AppointmentCreateRequest request = new AppointmentCreateRequest("John Doe", "john@test.com", "123", "Barber Alex", LocalDate.now(), "10:00", "Haircut");
        when(appointmentRepository.save(any(Appointment.class))).thenReturn(testAppointment);

        AppointmentResponse response = appointmentService.createAppointment(request, null);

        assertNotNull(response);
        assertEquals("John Doe", response.customerName());
        verify(appointmentRepository).save(any(Appointment.class));
    }

    @Test
    void testUpdateAppointmentStatus_Success() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(testAppointment));
        when(appointmentRepository.save(any(Appointment.class))).thenReturn(testAppointment);

        AppointmentUpdateRequest request = new AppointmentUpdateRequest("APPROVED");
        AppointmentResponse response = appointmentService.updateAppointmentStatus(1L, request);

        assertEquals("APPROVED", response.status());
        verify(appointmentRepository).save(testAppointment);
    }
    
    @Test
    void testUpdateAppointmentStatus_Denied() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(testAppointment));
        when(appointmentRepository.save(any(Appointment.class))).thenReturn(testAppointment);

        AppointmentUpdateRequest request = new AppointmentUpdateRequest("DENIED");
        AppointmentResponse response = appointmentService.updateAppointmentStatus(1L, request);

        assertEquals("DENIED", response.status());
        verify(appointmentRepository).save(testAppointment);
    }
    
    @Test
    void testNullEntityToResponse() {
        assertNull(AppointmentResponse.fromEntity(null));
    }

    @Test
    void testMaskMethodsThroughNotification() throws Exception {
        // We can test email dispatching edges by manipulating Appointment
        Appointment appt = new Appointment();
        appt.setCustomerEmail(null);
        appt.setCustomerName(null);
        appt.setStatus("PENDING");
        appt.setBarberName("Barber");
        appt.setBookingDate(LocalDate.now());
        appt.setBookingTime("10:00");
        appt.setServiceType("Haircut");
        appt.setId(2L);

        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(appt));
        when(appointmentRepository.save(any(Appointment.class))).thenReturn(appt);
        
        appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("OTHER"));
        
        appt.setCustomerEmail("a@"); // edge case
        appt.setCustomerName("ab"); // edge case
        appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("OTHER"));
        
        appt.setCustomerEmail("a"); // edge case
        appt.setCustomerName(""); // edge case
        appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("APPROVED"));
    }

    @Test
    void testGetBusySlots_NullOrShortDate() {
        // maskInput edge cases
        List<String> slots1 = appointmentService.getBusySlots("Barber Alex", null);
        assertTrue(slots1.isEmpty());
        
        List<String> slots2 = appointmentService.getBusySlots("Barber Alex", "123");
        assertTrue(slots2.isEmpty());
    }

    @Test
    void testUpdateAppointmentStatus_NotFound() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.empty());
        AppointmentUpdateRequest request = new AppointmentUpdateRequest("APPROVED");
        assertThrows(ResourceNotFoundException.class, () -> appointmentService.updateAppointmentStatus(1L, request));
    }

    @Test
    void testDeleteAppointment_Success() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(testAppointment));
        appointmentService.deleteAppointment(1L);
        verify(appointmentRepository).delete(testAppointment);
    }

    @Test
    void testDeleteAppointment_NotFound() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> appointmentService.deleteAppointment(1L));
    }

    @Test
    void testGetBusySlots_Success() {
        List<String> expectedSlots = Arrays.asList("10:00", "11:00");
        when(appointmentRepository.findDistinctBookingTimes(eq("Barber Alex"), any(LocalDate.class), eq("DENIED")))
                .thenReturn(expectedSlots);

        List<String> slots = appointmentService.getBusySlots("Barber Alex", LocalDate.now().toString());
        assertEquals(2, slots.size());
    }

    @Test
    void testGetBusySlots_ParseException() {
        List<String> slots = appointmentService.getBusySlots("Barber Alex", "invalid-date");
        assertTrue(slots.isEmpty());
    }

    @Test
    void testPublicCancelAppointment_Success() {
        when(appointmentRepository.findByPublicId("test-public-id")).thenReturn(testAppointment);
        appointmentService.publicCancelAppointment("test-public-id", "john@test.com");
        verify(appointmentRepository).delete(testAppointment);
    }

    @Test
    void testPublicCancelAppointment_NotFound() {
        when(appointmentRepository.findByPublicId("test-public-id")).thenReturn(null);
        assertThrows(ResourceNotFoundException.class, () -> appointmentService.publicCancelAppointment("test-public-id", "john@test.com"));
    }

    @Test
    void testPublicCancelAppointment_EmailMismatch() {
        when(appointmentRepository.findByPublicId("test-public-id")).thenReturn(testAppointment);
        assertThrows(IllegalArgumentException.class, () -> appointmentService.publicCancelAppointment("test-public-id", "wrong@test.com"));
    }

    @Test
    void testFindByPublicId() {
        when(appointmentRepository.findByPublicId("test-public-id")).thenReturn(testAppointment);
        Appointment found = appointmentService.findByPublicId("test-public-id");
        assertNotNull(found);
    }

    @Test
    @SuppressWarnings("unchecked")
    void testGetAppointmentStatsCached_CacheHit() {
        AppointmentStats cachedStats = new AppointmentStats(10L, 5L, 3L, 2L, 0L, 30, 75.0);
        when(cacheManager.getCache("appointmentStats")).thenReturn(cache);
        when(cache.get(eq(LocalDate.now()), any(java.util.concurrent.Callable.class))).thenReturn(cachedStats);

        AppointmentStats stats = appointmentService.getAppointmentStatsCached();

        assertNotNull(stats);
        assertEquals(10L, stats.total());
        assertEquals(5L, stats.pending());
        assertEquals(75.0, stats.approvedRevenue());
        verifyNoInteractions(appointmentRepository);
    }
}
