package com.example.taskflow.review;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ReviewControllerTest {

    @Mock
    private ReviewRepository reviewRepository;

    @Mock
    private AppointmentRepository appointmentRepository;

    private ReviewController reviewController;

    @BeforeEach
    void setUp() {
        reviewController = new ReviewController(reviewRepository, appointmentRepository);
    }

    @Test
    void getBarberRatings_shouldReturnList() {
        BarberRatingResponse rating = new BarberRatingResponse("Alex", 4.5, 10L);
        when(reviewRepository.getBarberRatings()).thenReturn(List.of(rating));

        ResponseEntity<List<BarberRatingResponse>> result = reviewController.getBarberRatings();

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals(1, result.getBody().size());
        assertEquals("Alex", result.getBody().get(0).barberName());
    }

    @Test
    void submitReview_shouldCreate() {
        Appointment appointment = new Appointment("John", "john@test.com", "555", "Alex",
                LocalDate.now(), "10:00", "Haircut");
        appointment.setId(1L);
        appointment.setStatus("APPROVED");
        when(appointmentRepository.findByPublicId("public-id")).thenReturn(appointment);
        when(reviewRepository.existsByAppointmentId(1L)).thenReturn(false);

        ReviewRequest request = new ReviewRequest(5, "Great!");

        ResponseEntity<Void> result = reviewController.submitReview("public-id", request);

        assertEquals(HttpStatus.CREATED, result.getStatusCode());
        verify(reviewRepository).save(any(Review.class));
    }

    @Test
    void submitReview_shouldThrowWhenAppointmentNotFound() {
        when(appointmentRepository.findByPublicId("bad-id")).thenReturn(null);

        ReviewRequest request = new ReviewRequest(5, "Great!");

        assertThrows(ResourceNotFoundException.class,
                () -> reviewController.submitReview("bad-id", request));
    }

    @Test
    void submitReview_shouldThrowWhenNotApproved() {
        Appointment appointment = new Appointment("John", "john@test.com", "555", "Alex",
                LocalDate.now(), "10:00", "Haircut");
        appointment.setStatus("PENDING");
        when(appointmentRepository.findByPublicId("pending-id")).thenReturn(appointment);

        ReviewRequest request = new ReviewRequest(5, "Great!");

        assertThrows(IllegalArgumentException.class,
                () -> reviewController.submitReview("pending-id", request));
    }

    @Test
    void submitReview_shouldThrowWhenDuplicate() {
        Appointment appointment = new Appointment("John", "john@test.com", "555", "Alex",
                LocalDate.now(), "10:00", "Haircut");
        appointment.setId(1L);
        appointment.setStatus("APPROVED");
        when(appointmentRepository.findByPublicId("dup-id")).thenReturn(appointment);
        when(reviewRepository.existsByAppointmentId(1L)).thenReturn(true);

        ReviewRequest request = new ReviewRequest(4, "OK");

        assertThrows(IllegalArgumentException.class,
                () -> reviewController.submitReview("dup-id", request));
    }
}
