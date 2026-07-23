package com.example.taskflow.catalog;

import com.example.taskflow.core.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class CatalogServiceImpl implements CatalogService {

    private final ServiceItemRepository repository;

    public CatalogServiceImpl(ServiceItemRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional(readOnly = true)
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
    public void deleteService(Long id) {
        ServiceItem item = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Service not found with id: " + id));
        repository.delete(item);
    }
}
