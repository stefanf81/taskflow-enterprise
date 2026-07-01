package com.example.taskflow.catalog;

import java.math.BigDecimal;

public record ServiceItemResponse(
    Long id,
    String name,
    BigDecimal price,
    Integer durationMinutes,
    String category,
    String description
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
