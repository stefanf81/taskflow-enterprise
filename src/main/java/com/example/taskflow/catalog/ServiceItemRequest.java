package com.example.taskflow.catalog;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;

public record ServiceItemRequest(
    @NotBlank(message = "Service name is required") String name,
    @NotNull(message = "Price is required") @Positive(message = "Price must be positive") BigDecimal price,
    @NotNull(message = "Duration is required") @Positive(message = "Duration must be positive") Integer durationMinutes,
    @NotBlank(message = "Category is required") String category,
    String description
) {}
