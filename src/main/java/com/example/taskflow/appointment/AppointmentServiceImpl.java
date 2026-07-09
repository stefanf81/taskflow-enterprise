package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.micrometer.tracing.Tracer;

import java.time.LocalDate;

@Service
@Transactional
public class AppointmentServiceImpl implements AppointmentService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentServiceImpl.class);
    private static final int MAX_BUSY_SLOTS = 500;
    
    private final AppointmentRepository appointmentRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final CacheManager cacheManager;
    private final Tracer tracer;
    private final BarberRepository barberRepository;
    private final BarberScheduleRepository barberScheduleRepository;
    private final BarberTimeOffRepository barberTimeOffRepository;
    private final BusySlotsService busySlotsService;

    public AppointmentServiceImpl(AppointmentRepository appointmentRepository, 
                                  ApplicationEventPublisher eventPublisher, 
                                  CacheManager cacheManager, 
                                  Tracer tracer,
                                  BarberRepository barberRepository,
                                  BarberScheduleRepository barberScheduleRepository,
                                  BarberTimeOffRepository barberTimeOffRepository,
                                  BusySlotsService busySlotsService) {
        this.appointmentRepository = appointmentRepository;
        this.eventPublisher = eventPublisher;
        this.cacheManager = cacheManager;
        this.tracer = tracer;
        this.barberRepository = barberRepository;
        this.barberScheduleRepository = barberScheduleRepository;
        this.barberTimeOffRepository = barberTimeOffRepository;
        this.busySlotsService = busySlotsService;
    }

    @Override
    @Transactional(readOnly = true)
    public AppointmentDashboardResponse getAllAppointments(String status, String searchName, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("bookingDate").ascending().and(Sort.by("bookingTime").ascending()));
        Page<Appointment> itemPage;

        if (status != null && !status.trim().isEmpty() && "OVERDUE".equalsIgnoreCase(status.trim())) {
            itemPage = appointmentRepository.findByStatusAndBookingDateBefore("PENDING", LocalDate.now(), pageable);
        } else if (status != null && !status.trim().isEmpty() && searchName != null && !searchName.trim().isEmpty()) {
            itemPage = appointmentRepository.findByStatusAndCustomerNameContainingIgnoreCase(status.trim(), searchName.trim(), pageable);
        } else if (status != null && !status.trim().isEmpty()) {
            itemPage = appointmentRepository.findByStatus(status.trim(), pageable);
        } else if (searchName != null && !searchName.trim().isEmpty()) {
            itemPage = appointmentRepository.findByCustomerNameContainingIgnoreCase(searchName.trim(), pageable);
        } else {
            itemPage = appointmentRepository.findAll(pageable);
        }

        Page<AppointmentResponse> responsePage = itemPage.map(AppointmentResponse::fromEntity);

        AppointmentStats stats = getAppointmentStatsCached();
        int progress = stats.total() > 0 ? (int) Math.round(((double) stats.approved() / stats.total()) * 100) : 0;
        
        AppointmentStats updatedStats = new AppointmentStats(
                stats.total(), stats.pending(), stats.approved(), stats.denied(), 
                stats.overdue(), progress, stats.approvedRevenue()
        );

        return new AppointmentDashboardResponse(responsePage, updatedStats);
    }

    public AppointmentStats getAppointmentStatsCached() {
        Cache cache = cacheManager.getCache("appointmentStats");
        if (cache != null) {
            return cache.get(LocalDate.now(), () -> appointmentRepository.getAppointmentStats(LocalDate.now()));
        }
        return appointmentRepository.getAppointmentStats(LocalDate.now());
    }

    private void clearAppointmentStatsCache() {
        Cache cache = cacheManager.getCache("appointmentStats");
        if (cache != null) {
            cache.clear();
        }
    }

    private void clearBusySlotsCache(String barberName, LocalDate bookingDate) {
        Cache cache = cacheManager.getCache("busySlots");
        if (cache != null) {
            cache.evict(barberName + "-" + bookingDate);
        }
    }

    @Override
    @Transactional(readOnly = true)
    public AppointmentResponse getAppointmentById(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        return AppointmentResponse.fromEntity(item);
    }

    @Override
    public AppointmentResponse createAppointment(AppointmentCreateRequest request, String idempotencyKey) {
        if (idempotencyKey != null && !idempotencyKey.trim().isEmpty()) {
            Appointment existing = appointmentRepository.findByIdempotencyKey(idempotencyKey);
            if (existing != null) {
                logger.info("Idempotency key {} already exists. Returning existing appointment.", idempotencyKey.replaceAll("[\\r\\n]", ""));
                return AppointmentResponse.fromEntity(existing);
            }
        }

        // Validate slot availability (prevent double-bookings and off-hour bookings)
        // Call via injected BusySlotsService so the @Cacheable proxy is actually used.
        java.util.List<String> busy = busySlotsService.getBusySlots(request.barberName(), request.bookingDate().toString());
        if (busy.contains(request.bookingTime())) {
            throw new IllegalArgumentException("The selected slot is already booked or unavailable.");
        }

        Appointment item = new Appointment();
        item.setIdempotencyKey(idempotencyKey);
        item.setCustomerName(request.customerName());
        item.setCustomerEmail(request.customerEmail());
        item.setCustomerPhone(request.customerPhone());
        item.setBarberName(request.barberName());
        item.setBookingDate(request.bookingDate());
        item.setBookingTime(request.bookingTime());
        item.setServiceType(request.serviceType());
        item.setStatus("PENDING");

        Appointment savedItem = appointmentRepository.save(item);
        clearAppointmentStatsCache();
        clearBusySlotsCache(savedItem.getBarberName(), savedItem.getBookingDate());

        try {
            io.micrometer.tracing.Span currentSpan = tracer.currentSpan();
            if (currentSpan != null) {
                currentSpan.tag("appointment.id", String.valueOf(savedItem.getId()));
                currentSpan.tag("appointment.customer", savedItem.getCustomerName());
                currentSpan.tag("appointment.status", savedItem.getStatus());
            }
        } catch (Exception e) {
            String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
            logger.warn("Failed to add tracing tags: {}", safeMsg);
        }

        return AppointmentResponse.fromEntity(savedItem);
    }

    @Override
    public AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));

        item.setStatus(request.status().toUpperCase());
        Appointment savedItem = appointmentRepository.save(item);
        clearAppointmentStatsCache();
        clearBusySlotsCache(savedItem.getBarberName(), savedItem.getBookingDate());

        try {
            io.micrometer.tracing.Span currentSpan = tracer.currentSpan();
            if (currentSpan != null) {
                currentSpan.tag("appointment.id", String.valueOf(savedItem.getId()));
                currentSpan.tag("appointment.status", savedItem.getStatus());
            }
        } catch (Exception e) {
            String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
            logger.warn("Failed to add tracing tags: {}", safeMsg);
        }

        eventPublisher.publishEvent(new AppointmentStatusChangedEvent(this, savedItem));

        return AppointmentResponse.fromEntity(savedItem);
    }

    @Override
    public void deleteAppointment(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        appointmentRepository.delete(item);
        clearAppointmentStatsCache();
        clearBusySlotsCache(item.getBarberName(), item.getBookingDate());

        try {
            io.micrometer.tracing.Span currentSpan = tracer.currentSpan();
            if (currentSpan != null) {
                currentSpan.tag("appointment.id", String.valueOf(id));
                currentSpan.tag("appointment.action", "delete");
            }
        } catch (Exception e) {
            String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
            logger.warn("Failed to add tracing tags: {}", safeMsg);
        }
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<String> getBusySlots(String barberName, String bookingDate) {
        return busySlotsService.getBusySlots(barberName, bookingDate);
    }

    @Override
    public void publicCancelAppointment(String publicId, String email) {
        Appointment item = appointmentRepository.findByPublicId(publicId);
        if (item == null) {
            throw new ResourceNotFoundException("Appointment booking not found.");
        }
        if (!item.getCustomerEmail().equalsIgnoreCase(email.trim())) {
            throw new IllegalArgumentException("Verification failed: The provided email address does not match this booking ID.");
        }
        appointmentRepository.delete(item);
        clearAppointmentStatsCache();
        clearBusySlotsCache(item.getBarberName(), item.getBookingDate());
    }

    @Override
    public Appointment findByPublicId(String publicId) {
        return appointmentRepository.findByPublicId(publicId);
    }

    private String maskInput(String input) {
        if (input == null || input.length() <= 4) {
            return "****";
        }
        String sanitized = input.replaceAll("[\\r\\n]", "");
        if (sanitized.length() <= 4) {
            return "****";
        }
        return sanitized.substring(0, 2) + "****" + sanitized.substring(sanitized.length() - 2);
    }
}
