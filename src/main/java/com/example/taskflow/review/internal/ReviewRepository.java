package com.example.taskflow.review.internal;

import com.example.taskflow.review.BarberRatingResponse;
import com.example.taskflow.review.Review;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Repository
public interface ReviewRepository extends JpaRepository<Review, Long> {
    
    boolean existsByAppointmentId(Long appointmentId);
    
    /**
     * Average and number of the counted reviews per barber, in one statement over this module's own
     * table (V38 put the barber and the "appointment still APPROVED" flag on each review).
     */
    @Query("SELECT new com.example.taskflow.review.BarberRatingResponse(r.barberName, AVG(r.rating), COUNT(r)) "
            + "FROM Review r WHERE r.counted = true GROUP BY r.barberName")
    List<BarberRatingResponse> findCountedRatingsPerBarber();

    /**
     * Marks the review of an appointment as counting or not. Returns the number of rows changed:
     * 0 when the appointment has no review or its flag already had this value. No flush or clear:
     * it runs inside the appointment's status transaction, whose managed entities must stay attached.
     */
    @Transactional
    @Modifying
    @Query("UPDATE Review r SET r.counted = :counted WHERE r.appointmentId = :appointmentId AND r.counted <> :counted")
    int updateCounted(@Param("appointmentId") Long appointmentId, @Param("counted") boolean counted);
}
