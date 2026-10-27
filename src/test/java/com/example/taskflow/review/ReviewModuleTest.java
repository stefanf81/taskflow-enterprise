package com.example.taskflow.review;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Boots review with the modules it may depend on. Reviews reference their appointment by id, so the
 * rating query joins the appointment table in JPQL; bootstrapping validates that query.
 */
@ApplicationModuleTest(mode = ApplicationModuleTest.BootstrapMode.ALL_DEPENDENCIES)
@TestPropertySource(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class ReviewModuleTest {

    @Autowired
    private ReviewService reviews;

    @Test
    void barberRatingsAreComputedAcrossTheAppointmentJoin() {
        assertNotNull(reviews.getBarberRatings());
    }
}
