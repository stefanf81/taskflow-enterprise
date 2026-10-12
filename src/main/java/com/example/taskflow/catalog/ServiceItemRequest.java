package com.example.taskflow.catalog;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/**
 * Admin payload for creating/updating a service. The limits mirror the V5 columns
 * ({@code name VARCHAR(100)}, {@code category VARCHAR(50)}, {@code description VARCHAR(500)},
 * {@code price DECIMAL(10,2)}) so oversize input is rejected with a 400 instead of surfacing as a
 * database error.
 */
public record ServiceItemRequest(
    @NotBlank(message = "Service name is required")
    @Size(max = 100, message = "Service name must not exceed 100 characters")
    String name,

    @NotNull(message = "Price is required")
    @Positive(message = "Price must be positive")
    @Digits(integer = 8, fraction = 2, message = "Price must have at most 8 integer digits and 2 decimals")
    BigDecimal price,

    @NotNull(message = "Duration is required")
    @Positive(message = "Duration must be positive")
    Integer durationMinutes,

    @NotBlank(message = "Category is required")
    @Size(max = 50, message = "Category must not exceed 50 characters")
    String category,

    @Size(max = 500, message = "Description must not exceed 500 characters")
    String description
) {}
