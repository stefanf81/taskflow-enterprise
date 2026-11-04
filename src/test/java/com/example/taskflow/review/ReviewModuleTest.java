package com.example.taskflow.review;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Boots review with the modules it may depend on. Reviews reference their appointment by id and carry
 * its barber and a "still approved" flag (V38), so the rating query reads the review table alone;
 * bootstrapping validates that query and the listener on the appointment events.
 */
@ApplicationModuleTest(mode = ApplicationModuleTest.BootstrapMode.ALL_DEPENDENCIES)
@TestPropertySource(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class ReviewModuleTest {

    @Autowired
    private ReviewService reviews;

    @Test
    void barberRatingsAreComputedFromTheReviews() {
        assertNotNull(reviews.getBarberRatings());
    }
}
