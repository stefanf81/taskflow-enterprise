package com.example.taskflow.catalog;

import com.example.taskflow.catalog.internal.RetailProduct;
import java.math.BigDecimal;
import org.jspecify.annotations.Nullable;

/** A retail product as both clients list it (display only, never booked). */
public record RetailProductResponse(
    Long id,
    String name,
    // Omitted from the JSON when null (spring.jackson.default-property-inclusion=non_null).
    @Nullable String sizeLabel,
    BigDecimal price,
    int sortOrder
) {
    static RetailProductResponse fromEntity(RetailProduct product) {
        return new RetailProductResponse(product.getId(), product.getName(), product.getSizeLabel(),
                product.getPrice(), product.getSortOrder());
    }
}
