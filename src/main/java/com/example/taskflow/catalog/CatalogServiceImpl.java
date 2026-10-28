package com.example.taskflow.catalog;
import com.example.taskflow.catalog.internal.ServiceItemRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

@Service
@Transactional
class CatalogServiceImpl implements CatalogService {

    private static final Logger logger = LoggerFactory.getLogger(CatalogServiceImpl.class);

    private final ServiceItemRepository repository;

    public CatalogServiceImpl(ServiceItemRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional(readOnly = true)
    @Cacheable(value = "services", sync = true)
    public List<ServiceItemResponse> getAllServices() {
        return repository.findAllProjectedBy();
    }

    @Override
    @Transactional(readOnly = true)
    public ServiceItemResponse getServiceById(Long id) {
        ServiceItem item = repository.findById(id)
                .filter(ServiceItem::isActive)
                .orElseThrow(() -> new ResourceNotFoundException("Service not found with id: " + id));
        return ServiceItemResponse.fromEntity(item);
    }

    /**
     * Creates a service. Names are unique case-insensitively (V32): a clash with an active service
     * answers 409; a clash with a RETIRED service reactivates that row with the new details instead,
     * so a retired name is not lost forever.
     */
    @Override
    @CacheEvict(value = "services", allEntries = true)
    public ServiceItemResponse createService(ServiceItemRequest request) {
        String name = request.name().trim();
        Optional<ServiceItem> sameName = repository.findByNameIgnoreCase(name);
        if (sameName.isPresent()) {
            ServiceItem existing = sameName.get();
            if (existing.isActive()) {
                throw nameConflict(name);
            }
            apply(existing, name, request);
            existing.setActive(true);
            return ServiceItemResponse.fromEntity(repository.save(existing));
        }

        ServiceItem item = new ServiceItem();
        apply(item, name, request);
        return ServiceItemResponse.fromEntity(repository.save(item));
    }

    @Override
    @CacheEvict(value = "services", allEntries = true)
    public ServiceItemResponse updateService(Long id, ServiceItemRequest request) {
        ServiceItem item = repository.findById(id)
                .filter(ServiceItem::isActive)
                .orElseThrow(() -> new ResourceNotFoundException("Service not found with id: " + id));

        String name = request.name().trim();
        if (repository.existsByNameIgnoreCaseAndIdNot(name, id)) {
            throw nameConflict(name);
        }
        apply(item, name, request);

        return ServiceItemResponse.fromEntity(repository.save(item));
    }

    /**
     * Deletes a service that no appointment references; otherwise RETIRES it ({@code active=false})
     * because {@code fk_appointment_service} forbids removing history. Either way the caller sees 204.
     */
    @Override
    @CacheEvict(value = "services", allEntries = true)
    public void deleteService(Long id) {
        ServiceItem item = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Service not found with id: " + id));
        if (repository.countAppointmentsReferencing(id) > 0) {
            if (item.isActive()) {
                item.setActive(false);
                repository.save(item);
                logger.info("Service id={} has appointments; retired instead of deleted", id);
            }
            return;
        }
        repository.delete(item);
    }

    /**
     * Public module API for cross-module lookups by display name. Delegates to
     * the module-private repository so callers never depend on
     * {@code catalog.internal.ServiceItemRepository} (Spring Modulith boundary).
     * Only ACTIVE services are returned, so a retired service cannot be booked.
     */
    @Override
    @Transactional(readOnly = true)
    public Optional<ServiceItem> findServiceByName(String name) {
        return repository.findByNameAndActiveTrue(name);
    }

    private static void apply(ServiceItem item, String name, ServiceItemRequest request) {
        item.setName(name);
        item.setPrice(request.price());
        item.setDurationMinutes(request.durationMinutes());
        item.setCategory(request.category());
        item.setDescription(request.description());
    }

    private static ResponseStatusException nameConflict(String name) {
        return new ResponseStatusException(HttpStatus.CONFLICT,
                "A service named '" + name.replace("\n", "").replace("\r", "") + "' already exists.");
    }
}
