package com.example.taskflow.catalog.internal;

import com.example.taskflow.catalog.RetailProductResponse;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

@Repository
public interface RetailProductRepository extends JpaRepository<RetailProduct, Long> {

    boolean existsByNameIgnoreCase(String name);

    boolean existsByNameIgnoreCaseAndIdNot(String name, Long id);

    /** The public list, in the shop's order (a DTO projection, like the services list). */
    @Query("""
            SELECT new com.example.taskflow.catalog.RetailProductResponse(
                p.id, p.name, p.sizeLabel, p.price, p.sortOrder
            )
            FROM RetailProduct p
            ORDER BY p.sortOrder, p.name
            """)
    List<RetailProductResponse> findAllProjected();
}
