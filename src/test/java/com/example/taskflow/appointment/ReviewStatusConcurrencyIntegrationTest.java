package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.review.ReviewRequest;
import com.example.taskflow.review.ReviewService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.CacheManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.aopalliance.intercept.MethodInterceptor;
import org.springframework.aop.framework.Advised;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.*;

/** Real service transactions, both lock orderings. Also inherited by the PostgreSQL test. */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class ReviewStatusConcurrencyIntegrationTest {
    @Autowired private AppointmentRepository appointments;
    @Autowired private AppointmentLifecycleService lifecycle;
    @Autowired private ReviewService reviews;
    @Autowired private PlatformTransactionManager transactions;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CacheManager caches;

    private Appointment approved;

    @BeforeEach
    void prepare() {
        jdbc.update("DELETE FROM reviews");
        appointments.deleteAll();
        caches.getCache("barberRatings").clear();
        Appointment booking = new Appointment("Customer", "race@example.com", "555", "Alex the Barber",
                LocalDate.of(2025, 1, 6), "10:00", "Classic Haircut");
        booking.setStatus(AppointmentStatus.APPROVED);
        approved = appointments.saveAndFlush(booking);
    }

    private void submitReview() {
        reviews.submitReview(approved.getPublicId(), new ReviewRequest(5, "Great", approved.getCustomerEmail()));
    }

    private void changeStatus(AppointmentStatus status) {
        if (status == AppointmentStatus.CANCELLED) lifecycle.deleteAppointment(approved.getId());
        else lifecycle.updateAppointmentStatus(approved.getId(), new AppointmentUpdateRequest(status.name()));
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(10, TimeUnit.SECONDS), "transaction did not reach its checkpoint");
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new AssertionError(ex);
        }
    }

    private static void assertBlocked(Future<?> waiter) {
        // The repository-entry latch is already signalled: this is a bounded assertion that the
        // competing operation cannot finish while the first transaction owns the row, not a sleep.
        assertThrows(TimeoutException.class, () -> waiter.get(200, TimeUnit.MILLISECONDS));
    }

    @ParameterizedTest
    @EnumSource(value = AppointmentStatus.class, names = {"CANCELLED", "DENIED"})
    void statusFirstRejectsTheReviewAfterCommit(AppointmentStatus status) throws Exception {
        CountDownLatch statusWritten = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch reviewReading = new CountDownLatch(1);
        MethodInterceptor checkpoint = call -> {
            if (call.getMethod().getName().equals("findByPublicIdForUpdate")) reviewReading.countDown();
            return call.proceed();
        };
        ((Advised) appointments).addAdvice(0, checkpoint);

        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> writer = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                changeStatus(status);
                statusWritten.countDown();
                await(release);
            }));
            await(statusWritten);
            Future<?> reviewer = pool.submit(this::submitReview);
            await(reviewReading);
            assertBlocked(reviewer);
            release.countDown();
            writer.get(10, TimeUnit.SECONDS);
            ExecutionException failure = assertThrows(ExecutionException.class,
                    () -> reviewer.get(10, TimeUnit.SECONDS));
            assertInstanceOf(IllegalArgumentException.class, failure.getCause());
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM reviews", Integer.class));
            assertFinalStatus(status);
        } finally {
            release.countDown();
            pool.shutdownNow();
            assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
            ((Advised) appointments).removeAdvice(checkpoint);
        }
    }

    @ParameterizedTest
    @EnumSource(value = AppointmentStatus.class, names = {"CANCELLED", "DENIED"})
    void reviewFirstMakesTheStatusWriterUncountItAfterCommit(AppointmentStatus status) throws Exception {
        CountDownLatch reviewWritten = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch statusFlushing = new CountDownLatch(1);
        MethodInterceptor checkpoint = call -> {
            if (call.getMethod().getName().equals("flush")) statusFlushing.countDown();
            return call.proceed();
        };
        ((Advised) appointments).addAdvice(0, checkpoint);

        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> reviewer = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                submitReview();
                reviewWritten.countDown();
                await(release);
            }));
            await(reviewWritten);
            Future<?> writer = pool.submit(() -> changeStatus(status));
            await(statusFlushing);
            assertBlocked(writer);
            release.countDown();
            reviewer.get(10, TimeUnit.SECONDS);
            writer.get(10, TimeUnit.SECONDS);
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM reviews", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM reviews WHERE counted = true", Integer.class));
            assertFinalStatus(status);
        } finally {
            release.countDown();
            pool.shutdownNow();
            assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
            ((Advised) appointments).removeAdvice(checkpoint);
        }
    }

    private void assertFinalStatus(AppointmentStatus status) {
        assertEquals(status, appointments.findById(approved.getId()).orElseThrow().getStatusEnum());
        assertTrue(reviews.getBarberRatings().isEmpty(), "cancelled/denied bookings must not count");
    }
}
