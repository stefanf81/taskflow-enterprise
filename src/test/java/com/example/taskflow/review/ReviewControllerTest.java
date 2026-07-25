package com.example.taskflow.review;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ReviewControllerTest {

    @Mock
    private ReviewService reviewService;

    private ReviewController reviewController;

    @BeforeEach
    void setUp() {
        reviewController = new ReviewController(reviewService);
    }

    @Test
    void getBarberRatings_shouldReturnList() {
        BarberRatingResponse rating = new BarberRatingResponse("Alex", 4.5, 10L);
        when(reviewService.getBarberRatings()).thenReturn(List.of(rating));

        ResponseEntity<List<BarberRatingResponse>> result = reviewController.getBarberRatings();

        assertEquals(HttpStatus.OK, result.getStatusCode());
        assertEquals(1, result.getBody().size());
        assertEquals("Alex", result.getBody().get(0).barberName());
    }

    @Test
    void submitReview_shouldCreate() {
        ReviewRequest request = new ReviewRequest(4, "Great!");
        doNothing().when(reviewService).submitReview(eq("test-public-id"), any(ReviewRequest.class));

        ResponseEntity<Void> result = reviewController.submitReview("test-public-id", request);

        assertEquals(HttpStatus.CREATED, result.getStatusCode());
        verify(reviewService).submitReview(eq("test-public-id"), any(ReviewRequest.class));
    }
}
