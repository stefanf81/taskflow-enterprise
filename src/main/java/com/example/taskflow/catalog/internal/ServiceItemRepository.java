package com.example.taskflow.catalog.internal;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.ServiceItemResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ServiceItemRepository extends JpaRepository<ServiceItem, Long> {

    /** Exact-name lookup including retired services (kept for tests/fixtures; not for booking). */
    Optional<ServiceItem> findByName(String name);

    /** Exact-name lookup restricted to ACTIVE services (retired services are not bookable). */
    Optional<ServiceItem> findByNameAndActiveTrue(String name);

    /** Case-insensitive lookup including retired services (V32 enforces unique lower(name)). */
    Optional<ServiceItem> findByNameIgnoreCase(String name);

    boolean existsByNameIgnoreCaseAndIdNot(String name, Long id);

    /**
     * Whether any appointment references the service. The catalog module must not depend on the
     * appointment module's entity (the dependency points the other way), so this is a native
     * count on the {@code appointments.service_id} foreign key column (fk_appointment_service).
     */
    @Query(value = "SELECT COUNT(*) FROM appointments WHERE service_id = :id", nativeQuery = true)
    long countAppointmentsReferencing(@Param("id") Long id);

    /**
     * DTO projection query: selects only the columns needed for API responses,
     * bypassing full entity loading and Hibernate's persistence context overhead.
     * Retired (inactive) services are excluded from the public list.
     */
    @Query("""
            SELECT new com.example.taskflow.catalog.ServiceItemResponse(
                s.id, s.name, s.price, s.durationMinutes, s.category, s.description
            )
            FROM ServiceItem s
            WHERE s.active = true
            ORDER BY s.name
            """)
    List<ServiceItemResponse> findAllProjectedBy();
}
