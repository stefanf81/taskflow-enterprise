package com.example.taskflow.catalog;

import com.example.taskflow.catalog.internal.RetailProduct;
import com.example.taskflow.catalog.internal.RetailProductRepository;
import com.example.taskflow.core.ResourceNotFoundException;
import java.util.List;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The shop's retail products (display only). Names are unique case-insensitively; every write
 * invalidates the cached public list after commit ({@link CatalogCacheInvalidationListener}).
 */
@Service
@Transactional
class RetailProductService {

    private final RetailProductRepository repository;
    private final ApplicationEventPublisher events;

    RetailProductService(RetailProductRepository repository, ApplicationEventPublisher events) {
        this.repository = repository;
        this.events = events;
    }

    @Transactional(readOnly = true)
    @Cacheable(value = CatalogCacheConfig.PRODUCTS_CACHE, sync = true)
    public List<RetailProductResponse> list() {
        return repository.findAllProjected();
    }

    public RetailProductResponse create(RetailProductRequest request) {
        String name = request.name().trim();
        if (repository.existsByNameIgnoreCase(name)) {
            throw nameConflict(name);
        }
        RetailProduct product = new RetailProduct();
        apply(product, name, request);
        events.publishEvent(new RetailProductsChangedEvent());
        return RetailProductResponse.fromEntity(repository.save(product));
    }

    public RetailProductResponse update(Long id, RetailProductRequest request) {
        RetailProduct product = find(id);
        String name = request.name().trim();
        if (repository.existsByNameIgnoreCaseAndIdNot(name, id)) {
            throw nameConflict(name);
        }
        apply(product, name, request);
        events.publishEvent(new RetailProductsChangedEvent());
        return RetailProductResponse.fromEntity(repository.save(product));
    }

    public void delete(Long id) {
        repository.delete(find(id));
        events.publishEvent(new RetailProductsChangedEvent());
    }

    private RetailProduct find(Long id) {
        return repository
                .findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Product not found with id: " + id));
    }

    private static void apply(RetailProduct product, String name, RetailProductRequest request) {
        product.setName(name);
        String size = request.sizeLabel();
        product.setSizeLabel(size == null || size.isBlank() ? null : size.trim());
        product.setPrice(request.price());
        product.setSortOrder(request.sortOrder());
    }

    private static ResponseStatusException nameConflict(String name) {
        return new ResponseStatusException(
                HttpStatus.CONFLICT,
                "A product named '" + name.replace("\n", "").replace("\r", "") + "' already exists.");
    }
}
