package com.example.taskflow.catalog;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/catalog")
@Tag(name = "Service Catalog", description = "Operations for managing shop services and pricing")
public class CatalogController {

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping
    @Operation(summary = "Get all services (Public Access)")
    @ApiResponse(responseCode = "200", description = "List of all services returned")
    public ResponseEntity<List<ServiceItemResponse>> getAllServices() {
        return ResponseEntity.ok(catalogService.getAllServices());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get a specific service by ID")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Service found and returned"),
            @ApiResponse(responseCode = "404", description = "Service not found")
    })
    public ResponseEntity<ServiceItemResponse> getServiceById(@Parameter(description = "Service database ID") @PathVariable Long id) {
        return ResponseEntity.ok(catalogService.getServiceById(id));
    }

    @PostMapping
    @Operation(summary = "Create a new service (Admin Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Service created successfully"),
            @ApiResponse(responseCode = "400", description = "Invalid service data")
    })
    public ResponseEntity<ServiceItemResponse> createService(@Valid @RequestBody ServiceItemRequest request) {
        return new ResponseEntity<>(catalogService.createService(request), HttpStatus.CREATED);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a service (Admin Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Service updated successfully"),
            @ApiResponse(responseCode = "400", description = "Invalid service data"),
            @ApiResponse(responseCode = "404", description = "Service not found")
    })
    public ResponseEntity<ServiceItemResponse> updateService(@Parameter(description = "Service database ID") @PathVariable Long id, @Valid @RequestBody ServiceItemRequest request) {
        return ResponseEntity.ok(catalogService.updateService(id, request));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a service (Admin Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "204", description = "Service deleted successfully"),
            @ApiResponse(responseCode = "404", description = "Service not found")
    })
    public ResponseEntity<Void> deleteService(@Parameter(description = "Service database ID") @PathVariable Long id) {
        catalogService.deleteService(id);
        return ResponseEntity.noContent().build();
    }
}
