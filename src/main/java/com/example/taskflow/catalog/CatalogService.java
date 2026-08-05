package com.example.taskflow.catalog;
import com.example.taskflow.catalog.internal.ServiceItemRepository;

import java.util.List;
import java.util.Optional;

public interface CatalogService {
    List<ServiceItemResponse> getAllServices();
    ServiceItemResponse getServiceById(Long id);
    ServiceItemResponse createService(ServiceItemRequest request);
    ServiceItemResponse updateService(Long id, ServiceItemRequest request);
    void deleteService(Long id);

    /**
     * Looks up a {@link ServiceItem} by its unique display name.
     *
     * <p>This is part of the catalog module's <em>public API</em>: it allows the
     * appointment module to resolve FK references by the human-readable service
     * name chosen on the booking form without reaching into the catalog
     * module's internal {@code ServiceItemRepository} (a Spring Modulith
     * boundary violation). The returned entity is part of the catalog module's
     * public types and may be safely attached to JPA relationships owned by
     * other modules.
     *
     * @param name the catalog display name (case-sensitive)
     * @return the matching {@link ServiceItem}, or empty if no such name exists
     */
    Optional<ServiceItem> findServiceByName(String name);
}
