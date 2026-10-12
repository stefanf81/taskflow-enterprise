package com.example.taskflow.review.internal;

import com.example.taskflow.review.BarberRatingResponse;
import com.example.taskflow.review.Review;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ReviewRepository extends JpaRepository<Review, Long> {
    
    boolean existsByAppointmentId(Long appointmentId);
    
    /**
     * Per-barber average rating. Only reviews whose appointment is still APPROVED count: a review
     * attached to an appointment that was later denied/cancelled no longer reflects a service that
     * was delivered.
     */
    @Query("SELECT new com.example.taskflow.review.BarberRatingResponse(r.appointment.barberName, AVG(r.rating), COUNT(r)) " +
           "FROM Review r WHERE r.appointment.status = com.example.taskflow.appointment.AppointmentStatus.APPROVED " +
           "GROUP BY r.appointment.barberName")
    List<BarberRatingResponse> getBarberRatings();
}
