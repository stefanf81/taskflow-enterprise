package com.example.taskflow.appointment;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface BarberRepository extends JpaRepository<Barber, Long> {
    Optional<Barber> findByName(String name);

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
}
