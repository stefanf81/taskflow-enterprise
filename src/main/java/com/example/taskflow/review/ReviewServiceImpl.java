package com.example.taskflow.review;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.appointment.AppointmentStatus;
import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ReviewServiceImpl implements ReviewService {

    private static final Logger logger = LoggerFactory.getLogger(ReviewServiceImpl.class);

    private final ReviewRepository reviewRepository;
    private final AppointmentRepository appointmentRepository;

    public ReviewServiceImpl(ReviewRepository reviewRepository, AppointmentRepository appointmentRepository) {
        this.reviewRepository = reviewRepository;
        this.appointmentRepository = appointmentRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<BarberRatingResponse> getBarberRatings() {
        return reviewRepository.getBarberRatings();
    }

    @Override
    @Transactional
    public void submitReview(String publicId, ReviewRequest request) {
        Appointment appointment = appointmentRepository.findByPublicId(publicId);
        if (appointment == null) {
            // Do not echo the publicId — that would let an attacker enumerate which
            // IDs exist (information disclosure / enumeration oracle).
            throw new ResourceNotFoundException("Appointment not found or not available for review.");
        }

        // Ownership proof: the reviewer must know the email used to book the
        // appointment, mirroring the public-cancel verification pattern. This
        // prevents anyone holding the public UUID from leaving a review for an
        // appointment they don't own.
        if (!appointment.getCustomerEmail().equalsIgnoreCase(request.customerEmail().trim())) {
            throw new IllegalArgumentException("Verification failed: the provided email does not match this booking.");
        }

        // Compare against the enum directly for type safety rather than the
        // String view of the status (which would silently miss a typo or a
        // future status renaming caught only at runtime).
        if (appointment.getStatusEnum() != AppointmentStatus.APPROVED) {
            throw new IllegalArgumentException("Only completed appointments can be reviewed.");
        }

        if (reviewRepository.existsByAppointmentId(appointment.getId())) {
            throw new IllegalArgumentException("Review has already been submitted for this appointment.");
        }

        Review review = new Review(appointment, request.rating(), request.comment());
        try {
            reviewRepository.save(review);
        } catch (org.springframework.dao.DataIntegrityViolationException ex) {
            // Concurrent duplicate review raced past the existsByAppointmentId
            // check above. The unique appointment_id constraint (V8) caught it.
            // Surface a controlled 400 instead of a 500 constraint-violation error.
            if (reviewRepository.existsByAppointmentId(appointment.getId())) {
                throw new IllegalArgumentException("Review has already been submitted for this appointment.");
            }
            // Unknown integrity violation — rethrow so the global handler maps it.
            throw ex;
        }
    }
}