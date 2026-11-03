package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Read side for the controllers: the admin dashboard (status filter including OVERDUE, search,
 * paging, stats), a single booking by id and the signed-in customer's own bookings.
 */
@Service
class AppointmentQueryService {

    private final AppointmentRepository appointmentRepository;
    private final AppointmentStatsService statsService;
    private final Clock clock;

    AppointmentQueryService(AppointmentRepository appointmentRepository, AppointmentStatsService statsService,
                            Clock clock) {
        this.appointmentRepository = appointmentRepository;
        this.statsService = statsService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AppointmentDashboardResponse getAllAppointments(String status, String searchName, int page, int size) {
        // Several barbers share a slot, so (date, time) alone is not a total order: id breaks the tie
        // so LIMIT/OFFSET pages neither repeat nor skip rows.
        Pageable pageable = PageRequest.of(page, size, Sort.by("bookingDate").ascending()
                .and(Sort.by("bookingTime").ascending())
                .and(Sort.by("id").ascending()));

        List<Specification<Appointment>> filters = new ArrayList<>();
        String statusFilter = status == null ? "" : status.trim();
        if ("OVERDUE".equalsIgnoreCase(statusFilter)) {
            // Overdue = still PENDING although the booking date has passed. The search
            // term below applies on top of it (it used to be silently ignored).
            LocalDate today = LocalDate.now(clock);
            filters.add((root, query, cb) -> cb.and(
                    cb.equal(root.get("status"), AppointmentStatus.PENDING),
                    cb.lessThan(root.<LocalDate>get("bookingDate"), today)));
        } else if (!statusFilter.isEmpty()) {
            // Unknown statuses are a 400, not a silent fall back to PENDING.
            AppointmentStatus parsed = AppointmentStatus.fromString(statusFilter);
            filters.add((root, query, cb) -> cb.equal(root.get("status"), parsed));
        }

        String term = searchName == null ? "" : searchName.trim();
        if (!term.isEmpty()) {
            filters.add(matchesSearchTerm(term));
        }

        // The unfiltered default view takes its total from the cached row count (evicted with the
        // stats on every booking) instead of counting the whole table on each request.
        Page<Appointment> itemPage = filters.isEmpty()
                ? new PageImpl<>(appointmentRepository.findPageWithoutCount(pageable).getContent(), pageable,
                        statsService.getTotalCountCached())
                : appointmentRepository.findAll(
                        (root, query, cb) -> cb.and(filters.stream()
                                .map(f -> f.toPredicate(root, query, cb))
                                .toArray(Predicate[]::new)),
                        pageable);

        Page<AppointmentResponse> responsePage = itemPage.map(AppointmentResponse::fromEntity);

        AppointmentStats stats = statsService.getStatsCached();
        return new AppointmentDashboardResponse(responsePage, stats);
    }

    /**
     * Admin search: case-insensitive "contains" on customer name, e-mail and phone, or an
     * exact public id (a UUID, so a partial match would be meaningless).
     */
    private static Specification<Appointment> matchesSearchTerm(String term) {
        String pattern = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
        return (root, query, cb) -> cb.or(
                cb.like(cb.lower(root.<String>get("customerName")), pattern, '\\'),
                cb.like(cb.lower(root.<String>get("customerEmail")), pattern, '\\'),
                cb.like(cb.lower(root.<String>get("customerPhone")), pattern, '\\'),
                cb.equal(root.<String>get("publicId"), term));
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    @Transactional(readOnly = true)
    public AppointmentResponse getAppointmentById(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        return AppointmentResponse.fromEntity(item);
    }

    @Transactional(readOnly = true)
    public Page<AppointmentResponse> getMyAppointments(String email, int page, int size) {
        // Newest first, with a unique tiebreaker so pages stay stable when bookings share a date/time.
        Pageable pageable = PageRequest.of(page, size, Sort.by("bookingDate").descending()
                .and(Sort.by("bookingTime").descending())
                .and(Sort.by("id").descending()));
        return appointmentRepository.findByCustomerEmailIgnoreCase(email, pageable)
                .map(AppointmentResponse::fromEntity);
    }
}
