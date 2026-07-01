package com.example.taskflow.catalog;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/catalog")
@CrossOrigin(origins = "${app.cors.allowed-origins:*}")
@Tag(name = "Service Catalog", description = "Operations for managing shop services and pricing")
public class CatalogController {

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping
    @Operation(summary = "Get all services (Public Access)")
    public ResponseEntity<List<ServiceItemResponse>> getAllServices() {
        return ResponseEntity.ok(catalogService.getAllServices());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get a specific service by ID")
    public ResponseEntity<ServiceItemResponse> getServiceById(@PathVariable Long id) {
        return ResponseEntity.ok(catalogService.getServiceById(id));
    }

    @PostMapping
    @Operation(summary = "Create a new service (Admin Access)")
    public ResponseEntity<ServiceItemResponse> createService(@Valid @RequestBody ServiceItemRequest request) {
        return new ResponseEntity<>(catalogService.createService(request), HttpStatus.CREATED);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a service (Admin Access)")
    public ResponseEntity<ServiceItemResponse> updateService(@PathVariable Long id, @Valid @RequestBody ServiceItemRequest request) {
        return ResponseEntity.ok(catalogService.updateService(id, request));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a service (Admin Access)")
    public ResponseEntity<Void> deleteService(@PathVariable Long id) {
        catalogService.deleteService(id);
        return ResponseEntity.noContent().build();
    }
}
