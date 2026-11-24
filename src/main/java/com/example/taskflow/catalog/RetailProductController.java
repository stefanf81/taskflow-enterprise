package com.example.taskflow.catalog;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Retail products (display only). The public list sits under the catalog's existing security rules:
 * {@code GET/HEAD /api/v1/catalog/*} is public, every write under {@code /api/v1/catalog/**} is
 * admin-only.
 */
@RestController
@RequestMapping("/api/v1/catalog/products")
@Tag(name = "Retail Products", description = "Products the shop sells over the counter (display only)")
class RetailProductController {

    private final RetailProductService products;

    RetailProductController(RetailProductService products) {
        this.products = products;
    }

    @GetMapping
    @Operation(summary = "Get the retail products (Public Access)")
    @ApiResponse(responseCode = "200", description = "Products in the shop's order")
    public ResponseEntity<List<RetailProductResponse>> listProducts() {
        // Admins edit the list from both clients, which refetch right afterwards: public, but
        // revalidated with the ETag (like GET /api/v1/catalog).
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().cachePublic())
                .body(products.list());
    }

    @PostMapping
    @Operation(summary = "Create a retail product (Admin Access)")
    @ApiResponses(
            value = {
                @ApiResponse(responseCode = "201", description = "Product created"),
                @ApiResponse(responseCode = "400", description = "Invalid product data"),
                @ApiResponse(responseCode = "409", description = "A product with that name exists")
            })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<RetailProductResponse> createProduct(@Valid @RequestBody RetailProductRequest request) {
        return new ResponseEntity<>(products.create(request), HttpStatus.CREATED);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a retail product (Admin Access)")
    @ApiResponses(
            value = {
                @ApiResponse(responseCode = "200", description = "Product updated"),
                @ApiResponse(responseCode = "400", description = "Invalid product data"),
                @ApiResponse(responseCode = "404", description = "Product not found"),
                @ApiResponse(responseCode = "409", description = "A product with that name exists")
            })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<RetailProductResponse> updateProduct(
            @Parameter(description = "Product database ID") @PathVariable Long id,
            @Valid @RequestBody RetailProductRequest request) {
        return ResponseEntity.ok(products.update(id, request));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a retail product (Admin Access)")
    @ApiResponses(
            value = {
                @ApiResponse(responseCode = "204", description = "Product deleted"),
                @ApiResponse(responseCode = "404", description = "Product not found")
            })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteProduct(@Parameter(description = "Product database ID") @PathVariable Long id) {
        products.delete(id);
        return ResponseEntity.noContent().build();
    }
}
