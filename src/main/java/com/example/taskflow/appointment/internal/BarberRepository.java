package com.example.taskflow.appointment.internal;

import com.example.taskflow.appointment.Barber;
import com.example.taskflow.appointment.BarberResponse;
import com.example.taskflow.appointment.PublicBarberResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface BarberRepository extends JpaRepository<Barber, Long> {
    Optional<Barber> findByName(String name);

    /** Serialize roster changes with booking validation on this barber. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT b FROM Barber b WHERE b.id = :id")
    Optional<Barber> findByIdForUpdate(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT b FROM Barber b WHERE b.id = :id")
    Optional<Barber> findByIdForBooking(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT b FROM Barber b ORDER BY b.id ASC")
    List<Barber> findAllForBooking();

    /** Every barber, lowest id first: the deterministic order "No Preference" assigns in. */
    List<Barber> findAllByOrderByIdAsc();

    /**
     * DTO projection query: selects only the columns needed for API responses,
     * bypassing full entity loading and Hibernate's persistence context overhead.
     */
    @Query("""
            SELECT new com.example.taskflow.appointment.BarberResponse(
                b.id, b.name, b.email, b.phone
            )
            FROM Barber b
            ORDER BY b.name
            """)
    List<BarberResponse> findAllProjectedBy();

    @Query("""
            SELECT new com.example.taskflow.appointment.PublicBarberResponse(b.id, b.name)
            FROM Barber b
            ORDER BY b.name
            """)
    List<PublicBarberResponse> findAllPublicProjectedBy();
}
