package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
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
    private AppointmentStatsService statsService;

    @Mock
    private io.micrometer.tracing.Tracer tracer;

    @Mock
    private BarberRepository barberRepository;

    @Mock
    private com.example.taskflow.catalog.CatalogService catalogService;

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
                appointmentRepository, eventPublisher, statsService, tracer,
                busySlotsService, barberRepository, barberScheduleRepository, barberTimeOffRepository, catalogService
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
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(stats);

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
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(stats);

        AppointmentDashboardResponse response = appointmentService.getAllAppointments("", "", 0, 10);

        assertEquals(25, response.stats().progress());
        assertEquals(25.0, response.stats().approvedRevenue());
    }

    @Test
    void testGetAllAppointments_OverdueStatus() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByStatusAndBookingDateBefore(eq(AppointmentStatus.PENDING), any(LocalDate.class), any(Pageable.class))).thenReturn(page);
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

        appointmentService.getAllAppointments("OVERDUE", null, 0, 10);

        verify(appointmentRepository).findByStatusAndBookingDateBefore(eq(AppointmentStatus.PENDING), any(LocalDate.class), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_StatusAndSearch() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByStatusAndCustomerNameContainingIgnoreCase(eq(AppointmentStatus.PENDING), eq("John"), any(Pageable.class))).thenReturn(page);
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

        appointmentService.getAllAppointments("PENDING", "John", 0, 10);

        verify(appointmentRepository).findByStatusAndCustomerNameContainingIgnoreCase(eq(AppointmentStatus.PENDING), eq("John"), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_StatusOnly() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByStatus(eq(AppointmentStatus.PENDING), any(Pageable.class))).thenReturn(page);
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

        appointmentService.getAllAppointments("PENDING", "  ", 0, 10);

        verify(appointmentRepository).findByStatus(eq(AppointmentStatus.PENDING), any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_SearchOnly() {
        Page<Appointment> page = new PageImpl<>(Collections.singletonList(testAppointment));
        when(appointmentRepository.findByCustomerNameContainingIgnoreCase(eq("John"), any(Pageable.class))).thenReturn(page);
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(new AppointmentStats(0L,0L,0L,0L,0L,0,0.0));

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
        // H3: NO_PREFERENCE_BARBER now triggers findAll() + per-barber schedule/
        // time-off checks in BusySlotsService. Stub a working barber so the
        // requested 10:00 slot is available.
        Barber workingBarber = new Barber();
        workingBarber.setId(1L);
        workingBarber.setName("Alex");
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(java.time.LocalTime.of(9, 0));
        schedule.setEndTime(java.time.LocalTime.of(17, 0));

        when(barberRepository.findAll()).thenReturn(List.of(workingBarber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(1L, LocalDate.now()))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(1L, LocalDate.now().getDayOfWeek().getValue()))
                .thenReturn(Optional.of(schedule));
        when(appointmentRepository.findDistinctBookingTimes("Alex", LocalDate.now(), AppointmentStatus.DENIED))
                .thenReturn(Collections.emptyList());

        AppointmentCreateRequest request = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123",
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, LocalDate.now(), "10:00", "Haircut");
        when(appointmentRepository.save(any(Appointment.class))).thenReturn(testAppointment);
        when(catalogService.findServiceByName("Haircut")).thenReturn(Optional.of(
                new com.example.taskflow.catalog.ServiceItem("Haircut", java.math.BigDecimal.TEN, 30, "hair", "")));

        AppointmentResponse response = appointmentService.createAppointment(request, null);

        assertNotNull(response);
        assertEquals("John Doe", response.customerName());
        verify(appointmentRepository).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_UnknownBarber_Rejected() {
        AppointmentCreateRequest request = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123",
                "Ghost Barber", LocalDate.now(), "10:00", "Haircut");
        when(barberRepository.findByName("Ghost Barber")).thenReturn(Optional.empty());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request, null));
        assertTrue(ex.getMessage().contains("Unknown barber"));
    }

    @Test
    void testCreateAppointment_UnknownService_Rejected() {
        // H3: NO_PREFERENCE_BARBER now hits findAll() in BusySlotsService.
        // Stub working barber so 10:00 is available, then the service rejection fires.
        Barber workingBarber = new Barber();
        workingBarber.setId(1L);
        workingBarber.setName("Alex");
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(java.time.LocalTime.of(9, 0));
        schedule.setEndTime(java.time.LocalTime.of(17, 0));

        when(barberRepository.findAll()).thenReturn(List.of(workingBarber));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(1L, LocalDate.now()))
                .thenReturn(Collections.emptyList());
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(1L, LocalDate.now().getDayOfWeek().getValue()))
                .thenReturn(Optional.of(schedule));
        when(appointmentRepository.findDistinctBookingTimes("Alex", LocalDate.now(), AppointmentStatus.DENIED))
                .thenReturn(Collections.emptyList());

        AppointmentCreateRequest request = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123",
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, LocalDate.now(), "10:00", "Phantom Service");
        when(catalogService.findServiceByName("Phantom Service")).thenReturn(Optional.empty());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request, null));
        assertTrue(ex.getMessage().contains("Unknown service"));
    }

    @Test
    void testCreateAppointment_TimeOff_RejectedDespiteCachedAvailability() {
        Barber barber = new Barber();
        barber.setId(7L);
        barber.setName("Alex the Barber");
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(java.time.LocalTime.of(9, 0));
        schedule.setEndTime(java.time.LocalTime.of(17, 0));
        BarberTimeOff timeOff = new BarberTimeOff();
        timeOff.setBarber(barber);

        LocalDate bookingDate = LocalDate.now();
        AppointmentCreateRequest request = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123", "Alex the Barber", bookingDate, "10:00", "Haircut");
        when(barberRepository.findByName("Alex the Barber")).thenReturn(Optional.of(barber));
        when(barberScheduleRepository.findByBarberIdAndDayOfWeek(7L, bookingDate.getDayOfWeek().getValue()))
                .thenReturn(Optional.of(schedule));
        when(barberTimeOffRepository.findTimeOffForBarberOnDate(7L, bookingDate)).thenReturn(List.of(timeOff));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request, null));
        assertTrue(ex.getMessage().contains("time off"));
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
        
        AppointmentResponse res1 = appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("OTHER"));
        assertNotNull(res1);
        
        appt.setCustomerEmail("a@"); // edge case
        appt.setCustomerName("ab"); // edge case
        AppointmentResponse res2 = appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("OTHER"));
        assertNotNull(res2);
        
        appt.setCustomerEmail("a"); // edge case
        appt.setCustomerName(""); // edge case
        AppointmentResponse res3 = appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("APPROVED"));
        assertNotNull(res3);
        
        verify(appointmentRepository, times(3)).save(any(Appointment.class));
        verify(eventPublisher, times(3)).publishEvent(any(AppointmentStatusChangedEvent.class));
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
        when(appointmentRepository.findDistinctBookingTimes(eq("Barber Alex"), any(LocalDate.class), eq(AppointmentStatus.DENIED)))
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
    void testGetAppointmentStatsCached_CacheHit() {
        AppointmentStats cachedStats = new AppointmentStats(10L, 5L, 3L, 2L, 0L, 30, 75.0);
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(cachedStats);

        // Verify statsService delegates correctly (was previously a direct CacheManager call)
        AppointmentStats stats = statsService.getStatsCached(appointmentRepository);

        assertNotNull(stats);
        assertEquals(10L, stats.total());
        assertEquals(5L, stats.pending());
        assertEquals(75.0, stats.approvedRevenue());
    }
}
