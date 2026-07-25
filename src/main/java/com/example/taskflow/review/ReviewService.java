package com.example.taskflow.review;

import java.util.List;

/**
 * Service layer for review operations.
 * Encapsulates business logic that was previously embedded directly in {@link ReviewController}.
 */
public interface ReviewService {

    /** Retrieve aggregated ratings for all barbers. */
    List<BarberRatingResponse> getBarberRatings();

    /** Submit a review for a completed appointment identified by its public UUID. */
    void submitReview(String publicId, ReviewRequest request);
}
