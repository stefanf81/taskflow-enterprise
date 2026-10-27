package com.example.taskflow.review;
import com.example.taskflow.review.internal.ReviewRepository;

import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentService;
import com.example.taskflow.appointment.AppointmentStatus;
import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
class ReviewServiceImpl implements ReviewService {

    /** SQL-standard SQLSTATE for a unique-constraint violation (PostgreSQL and H2). */
    private static final String UNIQUE_VIOLATION = "23505";

    private static final String ALREADY_REVIEWED = "Review has already been submitted for this appointment.";

    private final ReviewRepository reviewRepository;
    private final AppointmentService appointmentService;
    private final Clock clock;

    public ReviewServiceImpl(ReviewRepository reviewRepository, AppointmentService appointmentService, Clock clock) {
        this.reviewRepository = reviewRepository;
        this.appointmentService = appointmentService;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public List<BarberRatingResponse> getBarberRatings() {
        // Reviews reference their appointment by id. Only reviews whose appointment is still
        // APPROVED count: one attached to a booking that was later denied or cancelled no longer
        // reflects a service that was delivered. The appointment module answers which those are.
        List<ReviewRepository.AppointmentRating> ratings = reviewRepository.findAllRatings();
        Map<Long, String> barberByAppointment = appointmentService.findApprovedBarberNames(
                ratings.stream().map(ReviewRepository.AppointmentRating::getAppointmentId).toList());

        Map<String, long[]> sumAndCount = new TreeMap<>();
        for (ReviewRepository.AppointmentRating rating : ratings) {
            String barber = barberByAppointment.get(rating.getAppointmentId());
            if (barber == null || rating.getRating() == null) {
                continue;
            }
            long[] totals = sumAndCount.computeIfAbsent(barber, ignored -> new long[2]);
            totals[0] += rating.getRating();
            totals[1]++;
        }
        return sumAndCount.entrySet().stream()
                .map(e -> new BarberRatingResponse(e.getKey(), (double) e.getValue()[0] / e.getValue()[1], e.getValue()[1]))
                .toList();
    }

    @Override
    @Transactional
    public void submitReview(String publicId, ReviewRequest request) {
        // Resolve the appointment through the appointment module's public API
        // instead of reaching into its internal AppointmentRepository
        // (Spring Modulith module boundary).
        AppointmentDetails appointment = appointmentService.findDetailsByPublicId(publicId).orElse(null);
        if (appointment == null) {
            // Do not echo the publicId — that would let an attacker enumerate which
            // IDs exist (information disclosure / enumeration oracle).
            throw new ResourceNotFoundException("Appointment not found or not available for review.");
        }

        // Ownership proof: the reviewer must know the email used to book the
        // appointment, mirroring the public-cancel verification pattern. This
        // prevents anyone holding the public UUID from leaving a review for an
        // appointment they don't own.
        if (!appointment.customerEmail().equalsIgnoreCase(request.customerEmail().trim())) {
            throw new IllegalArgumentException("Verification failed: the provided email does not match this booking.");
        }

        // Compare against the enum directly for type safety rather than the
        // String view of the status (which would silently miss a typo or a
        // future status renaming caught only at runtime).
        if (appointment.status() != AppointmentStatus.APPROVED) {
            throw new IllegalArgumentException("Only completed appointments can be reviewed.");
        }

        // APPROVED only means the shop accepted the booking. A review is only meaningful once the
        // appointment has actually taken place, so reject it until its start has passed in the
        // shop's time zone (otherwise anyone could pre-load ratings for future bookings).
        if (!hasStarted(appointment)) {
            throw new IllegalArgumentException("This appointment has not taken place yet and cannot be reviewed.");
        }

        if (reviewRepository.existsByAppointmentId(appointment.id())) {
            throw new IllegalArgumentException(ALREADY_REVIEWED);
        }

        Review review = new Review(appointment.id(), request.rating(), request.comment());
        try {
            reviewRepository.save(review);
        } catch (DataIntegrityViolationException ex) {
            // A concurrent request raced past the existsByAppointmentId check and the unique
            // appointment_id constraint (V8) rejected this insert. Decide from the SQLSTATE of
            // the violation itself: re-querying here would fail on PostgreSQL, where the
            // transaction is already aborted ("current transaction is aborted") after the
            // failed statement.
            if (isUniqueViolation(ex)) {
                throw new IllegalArgumentException(ALREADY_REVIEWED, ex);
            }
            // Any other integrity violation (e.g. FK, not-null) is unexpected — rethrow so the
            // global handler maps it.
            throw ex;
        }
    }

    private boolean hasStarted(AppointmentDetails appointment) {
        if (appointment.bookingDate() == null || appointment.bookingTime() == null) {
            return false;
        }
        try {
            LocalDateTime start = LocalDateTime.of(
                    appointment.bookingDate(), LocalTime.parse(appointment.bookingTime().trim()));
            return !start.isAfter(LocalDateTime.now(clock));
        } catch (DateTimeParseException ex) {
            // An unparseable stored time cannot be proven to be in the past.
            return false;
        }
    }

    /** Walks the cause chain for a {@link SQLException} with SQLSTATE 23505. */
    static boolean isUniqueViolation(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof SQLException sql) {
                for (SQLException e = sql; e != null; e = e.getNextException()) {
                    if (UNIQUE_VIOLATION.equals(e.getSQLState())) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
