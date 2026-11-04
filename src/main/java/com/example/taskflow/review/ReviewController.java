package com.example.taskflow.review;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/reviews")
@Tag(name = "Client Reviews", description = "Public review submissions and rating aggregates")
class ReviewController {

    private final ReviewService reviewService;

    public ReviewController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    @GetMapping("/public/barber-ratings")
    @Operation(summary = "Get aggregated ratings for all barbers")
    @ApiResponse(responseCode = "200", description = "Aggregated barber ratings returned")
    public ResponseEntity<List<BarberRatingResponse>> getBarberRatings() {
        // Both clients reload the ratings right after the visitor submits a review. The server-side
        // cache is evicted when that review commits, so no-cache lets the reload see it, while the
        // ETag keeps an unchanged list at a 304.
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().cachePublic())
                .body(reviewService.getBarberRatings());
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
