package com.example.taskflow.review;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ReviewRepository extends JpaRepository<Review, Long> {
    
    @Query("SELECT new com.example.taskflow.review.BarberRatingResponse(r.appointment.barberName, AVG(r.rating), COUNT(r)) " +
           "FROM Review r GROUP BY r.appointment.barberName")
    List<BarberRatingResponse> getBarberRatings();
}
