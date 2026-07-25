package com.example.taskflow.review;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/reviews")
@Tag(name = "Client Reviews", description = "Public review submissions and rating aggregates")
public class ReviewController {

    private final ReviewService reviewService;

    public ReviewController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    @GetMapping("/public/barber-ratings")
    @Operation(summary = "Get aggregated ratings for all barbers")
    @ApiResponse(responseCode = "200", description = "Aggregated barber ratings returned")
    public ResponseEntity<List<BarberRatingResponse>> getBarberRatings() {
        return ResponseEntity.ok(reviewService.getBarberRatings());
    }

    @PostMapping("/public/{publicId}")
    @Operation(summary = "Submit a review for a completed appointment")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Review submitted successfully"),
            @ApiResponse(responseCode = "400", description = "Invalid review data, appointment not completed, or duplicate review"),
            @ApiResponse(responseCode = "404", description = "Appointment with given public ID not found")
    })
    public ResponseEntity<Void> submitReview(@Parameter(description = "Public UUID of the completed appointment") @PathVariable String publicId, @Valid @RequestBody ReviewRequest request) {
        reviewService.submitReview(publicId, request);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }
}
