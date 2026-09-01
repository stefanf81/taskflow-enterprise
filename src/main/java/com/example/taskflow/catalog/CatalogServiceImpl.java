package com.example.taskflow.catalog;
import com.example.taskflow.catalog.internal.ServiceItemRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class CatalogServiceImpl implements CatalogService {

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
                .orElseThrow(() -> new ResourceNotFoundException("Service not found with id: " + id));
        return ServiceItemResponse.fromEntity(item);
    }

    @Override
    @CacheEvict(value = "services", allEntries = true)
    public ServiceItemResponse createService(ServiceItemRequest request) {
        ServiceItem item = new ServiceItem(
            request.name(),
            request.price(),
            request.durationMinutes(),
            request.category(),
            request.description()
        );
        return ServiceItemResponse.fromEntity(repository.save(item));
    }

    @Override
    @CacheEvict(value = "services", allEntries = true)
    public ServiceItemResponse updateService(Long id, ServiceItemRequest request) {
        ServiceItem item = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Service not found with id: " + id));

        item.setName(request.name());
        item.setPrice(request.price());
        item.setDurationMinutes(request.durationMinutes());
        item.setCategory(request.category());
        item.setDescription(request.description());

        return ServiceItemResponse.fromEntity(repository.save(item));
    }

    @Override
    @CacheEvict(value = "services", allEntries = true)
    public void deleteService(Long id) {
        ServiceItem item = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Service not found with id: " + id));
        repository.delete(item);
    }

    /**
     * Public module API for cross-module lookups by display name. Delegates to
     * the module-private repository so callers never depend on
     * {@code catalog.internal.ServiceItemRepository} (Spring Modulith boundary).
     */
    @Override
    @Transactional(readOnly = true)
    public Optional<ServiceItem> findServiceByName(String name) {
        return repository.findByName(name);
    }
}
