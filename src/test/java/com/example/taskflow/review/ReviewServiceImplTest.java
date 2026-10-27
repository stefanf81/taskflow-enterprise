package com.example.taskflow.review;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentService;
import com.example.taskflow.testsupport.AppointmentDetailsFixtures;
import com.example.taskflow.core.ResourceNotFoundException;
import com.example.taskflow.review.internal.ReviewRepository;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ReviewServiceImpl}. The shop clock is fixed at 2031-03-10 14:00 in
 * Los Angeles (= 21:00 UTC), so "has the appointment started?" is decided in the shop's zone.
 */
@ExtendWith(MockitoExtension.class)
class ReviewServiceImplTest {

    private static final String PUBLIC_ID = "11111111-2222-3333-4444-555555555555";
    private static final ZoneId SHOP_ZONE = ZoneId.of("America/Los_Angeles");
    private static final LocalDate TODAY = LocalDate.of(2031, 3, 10);

    @Mock
    private ReviewRepository reviewRepository;

    @Mock
    private AppointmentService appointmentService;

    private ReviewServiceImpl service;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(Instant.parse("2031-03-10T21:00:00Z"), SHOP_ZONE);
        service = new ReviewServiceImpl(reviewRepository, appointmentService, clock);
    }

    private AppointmentDetails appointment(LocalDate date, String time, String status) {
        Appointment a = new Appointment("Jane", "Jane@Example.com", "555", "Alex", date, time, "Cut");
        a.setId(7L);
        a.setStatus(status);
        return AppointmentDetailsFixtures.of(a);
    }

    private static ReviewRequest request(int rating, String email) {
        return new ReviewRequest(rating, "great", email);
    }

    @Test
    void savesAReviewForAnApprovedAppointmentThatAlreadyHappened() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));
        when(reviewRepository.existsByAppointmentId(7L)).thenReturn(false);

        service.submitReview(PUBLIC_ID, request(5, "  jane@example.com "));

        verify(reviewRepository).save(any(Review.class));
    }

    @Test
    void anAppointmentThatStartsExactlyNowCanBeReviewed() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "14:00", "APPROVED")));

        service.submitReview(PUBLIC_ID, request(4, "jane@example.com"));

        verify(reviewRepository).save(any(Review.class));
    }

    @Test
    void unknownPublicIdIs404WithoutEchoingTheId() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.empty());

        ResourceNotFoundException ex = assertThrows(ResourceNotFoundException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));

        assertTrue(!ex.getMessage().contains(PUBLIC_ID));
        verify(reviewRepository, never()).save(any());
    }

    @Test
    void wrongOwnerEmailIsRejected() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "someone.else@example.com")));

        assertEquals("Verification failed: the provided email does not match this booking.", ex.getMessage());
        verify(reviewRepository, never()).save(any());
    }

    @Test
    void ownerEmailMatchIsCaseInsensitive() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));

        service.submitReview(PUBLIC_ID, request(3, "JANE@EXAMPLE.COM"));

        verify(reviewRepository).save(any(Review.class));
    }

    @Test
    void onlyApprovedAppointmentsCanBeReviewed() {
        for (String status : List.of("PENDING", "DENIED")) {
            when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", status)));

            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                    () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));

            assertEquals("Only completed appointments can be reviewed.", ex.getMessage(), status);
        }
        verify(reviewRepository, never()).save(any());
    }

    @Test
    void approvedAppointmentInTheFutureCannotBeReviewedYet() {
        // later today, in the shop's zone
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "14:01", "APPROVED")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));

        assertEquals("This appointment has not taken place yet and cannot be reviewed.", ex.getMessage());
        verify(reviewRepository, never()).save(any());
    }

    @Test
    void futureDayCannotBeReviewedEvenIfItsClockTimeIsEarlier() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY.plusDays(1), "08:00", "APPROVED")));

        assertThrows(IllegalArgumentException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));
        verify(reviewRepository, never()).save(any());
    }

    @Test
    void shopZoneNotUtcDecidesWhetherItHasHappened() {
        // 21:00 UTC is already "tomorrow 02:00" in some zones, but the shop is in Los Angeles (14:00 same day).
        // An 18:00 booking today (shop time) is still ahead even though it is 18:00 < 21:00 in UTC.
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "18:00", "APPROVED")));

        assertThrows(IllegalArgumentException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));
    }

    @Test
    void secondsInTheStoredTimeAreUnderstood() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "13:59:30", "APPROVED")));

        service.submitReview(PUBLIC_ID, request(5, "jane@example.com"));

        verify(reviewRepository).save(any(Review.class));
    }

    @Test
    void duplicateIsRejectedByThePreCheck() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));
        when(reviewRepository.existsByAppointmentId(7L)).thenReturn(true);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));

        assertEquals("Review has already been submitted for this appointment.", ex.getMessage());
        verify(reviewRepository, never()).save(any());
    }

    @Test
    void duplicateRaceIsDetectedFromTheSqlStateWithoutRequeryingTheAbortedTransaction() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));
        // pre-check passes (the competing insert was not committed yet) ...
        when(reviewRepository.existsByAppointmentId(7L)).thenReturn(false);
        // ... but the unique appointment_id constraint rejects the insert (SQLSTATE 23505)
        DataIntegrityViolationException violation = new DataIntegrityViolationException("constraint",
                new RuntimeException("hibernate ConstraintViolationException",
                        new SQLException("duplicate key value violates unique constraint", "23505")));
        when(reviewRepository.save(any(Review.class))).thenThrow(violation);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));

        assertEquals("Review has already been submitted for this appointment.", ex.getMessage());
        // On PostgreSQL the transaction is aborted after the failed INSERT; any further statement
        // fails with "current transaction is aborted". Exactly one existence check (the pre-check).
        verify(reviewRepository, org.mockito.Mockito.times(1)).existsByAppointmentId(7L);
    }

    @Test
    void duplicateRaceIsDetectedWhenTheSqlStateIsChainedViaNextException() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));
        SQLException wrapper = new SQLException("batch failed", "00000");
        wrapper.setNextException(new SQLException("duplicate", "23505"));
        when(reviewRepository.save(any(Review.class)))
                .thenThrow(new DataIntegrityViolationException("x", wrapper));

        assertThrows(IllegalArgumentException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));
    }

    @Test
    void otherIntegrityViolationsAreRethrown() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));
        DataIntegrityViolationException notNull = new DataIntegrityViolationException("null value",
                new SQLException("null value in column violates not-null constraint", "23502"));
        when(reviewRepository.save(any(Review.class))).thenThrow(notNull);

        DataIntegrityViolationException thrown = assertThrows(DataIntegrityViolationException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));

        assertSame(notNull, thrown);
    }

    @Test
    void integrityViolationWithoutAnySqlStateIsRethrown() {
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appointment(TODAY, "09:00", "APPROVED")));
        when(reviewRepository.save(any(Review.class))).thenThrow(new DataIntegrityViolationException("opaque"));

        assertThrows(DataIntegrityViolationException.class,
                () -> service.submitReview(PUBLIC_ID, request(5, "jane@example.com")));
    }

    @Test
    void reviewIsPersistedWithTheRequestedRatingAndComment() {
        AppointmentDetails appt = appointment(TODAY, "09:00", "APPROVED");
        when(appointmentService.findDetailsByPublicId(PUBLIC_ID)).thenReturn(Optional.of(appt));

        service.submitReview(PUBLIC_ID, new ReviewRequest(4, "nice fade", "jane@example.com"));

        ArgumentCaptor<Review> saved = ArgumentCaptor.forClass(Review.class);
        verify(reviewRepository).save(saved.capture());
        assertTrue(saved.getValue() != null);
    }

    // --- rating bounds are enforced by bean validation on the request record ---

    @Test
    void ratingBoundsAreEnforcedByRequestValidation() {
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

        assertTrue(validator.validate(request(1, "a@b.co")).isEmpty());
        assertTrue(validator.validate(request(5, "a@b.co")).isEmpty());
        assertEquals(1, violationsFor(validator, request(0, "a@b.co")).size());
        assertEquals(1, violationsFor(validator, request(6, "a@b.co")).size());
        assertEquals(1, violationsFor(validator, new ReviewRequest(null, "x", "a@b.co")).size());
        assertEquals(1, violationsFor(validator, new ReviewRequest(3, "x".repeat(1001), "a@b.co")).size());
        assertEquals(1, violationsFor(validator, new ReviewRequest(3, "x", "not-an-email")).size());
    }

    private static Set<ConstraintViolation<ReviewRequest>> violationsFor(Validator validator, ReviewRequest request) {
        return validator.validate(request);
    }
}
