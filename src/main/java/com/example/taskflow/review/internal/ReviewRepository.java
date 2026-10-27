package com.example.taskflow.review.internal;

import com.example.taskflow.review.Review;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ReviewRepository extends JpaRepository<Review, Long> {
    
    boolean existsByAppointmentId(Long appointmentId);
    
    /** Every review's appointment and rating; the ratings are aggregated per barber in the service. */
    @Query("SELECT r.appointmentId AS appointmentId, r.rating AS rating FROM Review r")
    List<AppointmentRating> findAllRatings();

    interface AppointmentRating {
        Long getAppointmentId();

        Integer getRating();
    }
}
