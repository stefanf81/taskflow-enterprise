package com.example.taskflow.review;

import com.example.taskflow.appointment.AppointmentCancelledEvent;
import com.example.taskflow.appointment.AppointmentStatus;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.review.internal.ReviewRepository;
import com.example.taskflow.testsupport.AppointmentDetailsFixtures;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DATA-4: the per-barber rating aggregate must only count reviews whose appointment is still
 * APPROVED (a review on an appointment that was later denied no longer reflects a delivered service).
 * The status changes go through the events the appointment module publishes, so these tests also
 * cover the per-review flag (V38) and the eviction of the cached ratings.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class ReviewRatingsIntegrationTest {

    @Autowired private ReviewRepository reviewRepository;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private ReviewService reviewService;
    @Autowired private ApplicationEventPublisher eventPublisher;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private CacheManager cacheManager;

    private int minute;

    @BeforeEach
    void clean() {
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
        // rows written straight to the repositories bypass the events that evict the cached ratings
        ratingsCache().clear();
    }

    private Cache ratingsCache() {
        return cacheManager.getCache(ReviewCacheConfig.BARBER_RATINGS_CACHE);
    }

    private Appointment booking(String barber) {
        int m = minute++;
        Appointment a = new Appointment("C" + m, "c" + m + "@x.test", "555", barber,
                LocalDate.of(2025, 1, 6), String.format("10:%02d", m), "Classic Haircut");
        a.setStatus(AppointmentStatus.APPROVED);
        return appointmentRepository.save(a);
    }

    private Appointment reviewed(String barber, int rating) {
        Appointment a = booking(barber);
        reviewRepository.save(new Review(a.getId(), barber, rating, "r"));
        return a;
    }

    /** A status change as the appointment module makes it: the row and its event in one transaction. */
    private void changeStatus(Appointment appointment, AppointmentStatus status) {
        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
            Appointment current = appointmentRepository.findById(appointment.getId()).orElseThrow();
            current.setStatus(status);
            Appointment saved = appointmentRepository.save(current);
            eventPublisher.publishEvent(status == AppointmentStatus.CANCELLED
                    ? new AppointmentCancelledEvent(AppointmentDetailsFixtures.of(saved),
                            AppointmentCancelledEvent.CancelledBy.ADMIN)
                    : new AppointmentStatusChangedEvent(this, AppointmentDetailsFixtures.of(saved)));
        });
    }

    private BarberRatingResponse ratingOf(List<BarberRatingResponse> ratings, String barber) {
        return ratings.stream().filter(r -> r.barberName().equals(barber)).findFirst().orElseThrow();
    }

    @Test
    void aggregateIgnoresReviewsOfAppointmentsThatAreNotApproved() {
        reviewed("Alex the Barber", 5);
        reviewed("Alex the Barber", 3);
        changeStatus(reviewed("Alex the Barber", 1), AppointmentStatus.DENIED);   // must not drag the average down
        changeStatus(reviewed("Sara the Stylist", 1), AppointmentStatus.DENIED);  // a barber with only invalid reviews disappears
        reviewed("Marcus Master Blade", 4);

        List<BarberRatingResponse> ratings = reviewService.getBarberRatings();

        assertEquals(2, ratings.size());
        BarberRatingResponse alex = ratingOf(ratings, "Alex the Barber");
        assertEquals(2L, alex.reviewCount());
        assertEquals(4.0, alex.averageRating(), 0.0001);
        assertEquals(1L, ratingOf(ratings, "Marcus Master Blade").reviewCount());
    }

    @Test
    void aChangeOfAReviewedAppointmentEvictsTheCachedRatings() {
        Appointment reviewed = reviewed("Alex the Barber", 5);
        assertEquals(1L, ratingOf(reviewService.getBarberRatings(), "Alex the Barber").reviewCount());

        changeStatus(reviewed, AppointmentStatus.CANCELLED);
        assertTrue(reviewService.getBarberRatings().isEmpty(), "a cancelled booking's review no longer counts");

        changeStatus(reviewed, AppointmentStatus.APPROVED);
        assertEquals(5.0, ratingOf(reviewService.getBarberRatings(), "Alex the Barber").averageRating(), 0.0001);
    }

    @Test
    void aChangeOfAnUnreviewedAppointmentKeepsTheCachedRatings() {
        reviewed("Alex the Barber", 5);
        reviewService.getBarberRatings();

        changeStatus(booking("Alex the Barber"), AppointmentStatus.DENIED);

        assertNotNull(ratingsCache().get(ReviewCacheConfig.ALL_RATINGS_KEY),
                "approving or declining an upcoming booking cannot change any rating");
    }
}
