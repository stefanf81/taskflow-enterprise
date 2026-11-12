package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
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
        // Newest first: the dashboard opens on the latest (and upcoming) bookings, not on the oldest
        // history. Several barbers share a slot, so (date, time) alone is not a total order: id
        // breaks the tie so LIMIT/OFFSET pages neither repeat nor skip rows. The whole key is one
        // index (V42), read backwards.
        Pageable pageable = newestFirstPageable(page, size);
        String statusFilter = status == null ? "" : status.trim();
        String term = searchName == null ? "" : searchName.trim();
        boolean overdue = "OVERDUE".equalsIgnoreCase(statusFilter);
        // Unknown statuses are a 400, not a silent fall back to PENDING.
        AppointmentStatus parsed = overdue || statusFilter.isEmpty() ? null : AppointmentStatus.fromString(statusFilter);
        LocalDate today = LocalDate.now(clock);
        AppointmentStats stats = statsService.getStatsCached();

        Page<Appointment> itemPage;
        if (term.isEmpty()) {
            // Without a search term the total is already known: the unfiltered view takes it from the
            // cached row count and a status view from the cached dashboard counters (both evicted on
            // every booking and status change), instead of counting the table on each request.
            Slice<Appointment> slice;
            long total;
            if (overdue) {
                slice = appointmentRepository.findByStatusAndBookingDateBefore(
                        AppointmentStatus.PENDING, today, pageable);
                total = stats.overdue();
            } else if (parsed != null) {
                slice = appointmentRepository.findByStatus(parsed, pageable);
                total = countOf(parsed, stats);
            } else {
                slice = appointmentRepository.findPageWithoutCount(pageable);
                total = statsService.getTotalCountCached();
            }
            List<Appointment> content = slice.getContent();
            long minTotal = pageable.getOffset() + content.size() + (slice.hasNext() ? 1L : 0L);
            itemPage = new PageImpl<>(content, pageable, Math.max(total, minTotal));
        } else {
            List<Specification<Appointment>> filters = new ArrayList<>();
            if (overdue) {
                // Overdue = still PENDING although the booking date has passed. The search term
                // applies on top of it (it used to be silently ignored).
                filters.add((root, query, cb) -> cb.and(
                        cb.equal(root.get("status"), AppointmentStatus.PENDING),
                        cb.lessThan(root.<LocalDate>get("bookingDate"), today)));
            } else if (parsed != null) {
                filters.add((root, query, cb) -> cb.equal(root.get("status"), parsed));
            }
            filters.add(matchesSearchTerm(term));
            itemPage = appointmentRepository.findAll(
                    (root, query, cb) -> cb.and(filters.stream()
                            .map(f -> f.toPredicate(root, query, cb))
                            .toArray(Predicate[]::new)),
                    pageable);
        }
        Page<AppointmentResponse> responsePage = itemPage.map(AppointmentResponse::fromEntity);
        return new AppointmentDashboardResponse(responsePage, stats);
    }

    /**
     * Rows with one status, from the dashboard counters. {@code total} counts every row except the
     * cancelled ones, so those are the rest of the table's row count (never below zero: the two
     * cached values are loaded separately and a booking may land in between).
     */
    private long countOf(AppointmentStatus status, AppointmentStats stats) {
        return switch (status) {
            case PENDING -> stats.pending();
            case APPROVED -> stats.approved();
            case DENIED -> stats.denied();
            case CANCELLED -> Math.max(0, statsService.getTotalCountCached() - stats.total());
        };
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
        Pageable pageable = newestFirstPageable(page, size);
        return appointmentRepository.findByCustomerEmailIgnoreCase(email, pageable)
                .map(AppointmentResponse::fromEntity);
    }

    /**
     * Spring Data JPA turns {@link Pageable#getOffset()} into a 32-bit SQL {@code OFFSET} via
     * {@code PageableUtils.getOffsetAsInteger}, which throws {@code InvalidDataAccessApiUsageException}
     * (HTTP 500) past {@link Integer#MAX_VALUE}. Refuse negative bounds and overflowing offsets with 400.
     */
    private static Pageable newestFirstPageable(int page, int size) {
        if (page < 0 || size < 1 || (long) page * size > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Invalid pagination parameters.");
        }
        return PageRequest.of(page, size, Sort.by("bookingDate").descending()
                .and(Sort.by("bookingTime").descending())
                .and(Sort.by("id").descending()));
    }
}
