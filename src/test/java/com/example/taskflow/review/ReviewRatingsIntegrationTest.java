package com.example.taskflow.review;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.review.internal.ReviewRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * DATA-4: the per-barber rating aggregate must only count reviews whose appointment is still
 * APPROVED (a review on an appointment that was later denied no longer reflects a delivered service).
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class ReviewRatingsIntegrationTest {

    @Autowired private ReviewRepository reviewRepository;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private ReviewService reviewService;

    @BeforeEach
    void clean() {
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
    }

    private void review(String barber, String status, int rating, int minute) {
        Appointment a = new Appointment("C" + minute, "c" + minute + "@x.test", "555", barber,
                LocalDate.of(2025, 1, 6), String.format("10:%02d", minute), "Classic Haircut");
        a.setStatus(status);
        a = appointmentRepository.save(a);
        reviewRepository.save(new Review(a.getId(), rating, "r"));
    }

    @Test
    void aggregateIgnoresReviewsOfAppointmentsThatAreNotApproved() {
        review("Alex the Barber", "APPROVED", 5, 0);
        review("Alex the Barber", "APPROVED", 3, 1);
        review("Alex the Barber", "DENIED", 1, 2);   // must not drag the average down
        review("Sara the Stylist", "DENIED", 1, 3);  // a barber with only invalid reviews disappears
        review("Marcus Master Blade", "APPROVED", 4, 4);

        List<BarberRatingResponse> ratings = reviewService.getBarberRatings();

        assertEquals(2, ratings.size());
        BarberRatingResponse alex = ratings.stream().filter(r -> r.barberName().equals("Alex the Barber"))
                .findFirst().orElseThrow();
        assertEquals(2L, alex.reviewCount());
        assertEquals(4.0, alex.averageRating(), 0.0001);
        BarberRatingResponse marcus = ratings.stream().filter(r -> r.barberName().equals("Marcus Master Blade"))
                .findFirst().orElseThrow();
        assertEquals(1L, marcus.reviewCount());
    }
}
