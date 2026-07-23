package com.example.taskflow.catalog;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ServiceItemRepository extends JpaRepository<ServiceItem, Long> {
    Optional<ServiceItem> findByName(String name);

    /**
     * DTO projection query: selects only the columns needed for API responses,
     * bypassing full entity loading and Hibernate's persistence context overhead.
     */
    @Query("""
            SELECT new com.example.taskflow.catalog.ServiceItemResponse(
                s.id, s.name, s.price, s.durationMinutes, s.category, s.description
            )
            FROM ServiceItem s
            ORDER BY s.name
            """)
    List<ServiceItemResponse> findAllProjectedBy();
}
