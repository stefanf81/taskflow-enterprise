package com.example.taskflow.review;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.appointment.AppointmentStatus;
import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ReviewServiceImpl implements ReviewService {

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
        reviewRepository.save(review);
    }
}
