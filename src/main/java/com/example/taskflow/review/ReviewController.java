package com.example.taskflow.review;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.core.ResourceNotFoundException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/reviews")
@CrossOrigin(origins = "${app.cors.allowed-origins:*}")
@Tag(name = "Client Reviews", description = "Public review submissions and rating aggregates")
public class ReviewController {

    private final ReviewRepository reviewRepository;
    private final AppointmentRepository appointmentRepository;

    public ReviewController(ReviewRepository reviewRepository, AppointmentRepository appointmentRepository) {
        this.reviewRepository = reviewRepository;
        this.appointmentRepository = appointmentRepository;
    }

    @GetMapping("/public/barber-ratings")
    @Operation(summary = "Get aggregated ratings for all barbers")
    public ResponseEntity<List<BarberRatingResponse>> getBarberRatings() {
        return ResponseEntity.ok(reviewRepository.getBarberRatings());
    }

    @PostMapping("/public/{publicId}")
    @Operation(summary = "Submit a review for a completed appointment")
    public ResponseEntity<Void> submitReview(@PathVariable String publicId, @Valid @RequestBody ReviewRequest request) {
        Appointment appointment = appointmentRepository.findByPublicId(publicId);
        if (appointment == null) {
            throw new ResourceNotFoundException("Appointment not found with public ID: " + publicId);
        }
        
        if (!"APPROVED".equals(appointment.getStatus())) { // Ideally we should have a COMPLETED status, but APPROVED acts as completed for now
            throw new IllegalArgumentException("Only completed appointments can be reviewed.");
        }

        if (reviewRepository.existsByAppointmentId(appointment.getId())) {
            throw new IllegalArgumentException("Review has already been submitted for this appointment.");
        }

        Review review = new Review(appointment, request.rating(), request.comment());
        reviewRepository.save(review);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }
}
