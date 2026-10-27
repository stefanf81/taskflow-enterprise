package com.example.taskflow.catalog;

import org.jspecify.annotations.Nullable;

import java.math.BigDecimal;

public record ServiceItemResponse(
    Long id,
    String name,
    BigDecimal price,
    Integer durationMinutes,
    String category,
    // Omitted from the JSON when null (spring.jackson.default-property-inclusion=non_null).
    @Nullable String description
) {
    public static ServiceItemResponse fromEntity(ServiceItem item) {
        return new ServiceItemResponse(
            item.getId(),
            item.getName(),
            item.getPrice(),
            item.getDurationMinutes(),
            item.getCategory(),
            item.getDescription()
        );
    }
}
