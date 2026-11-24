package com.example.taskflow.catalog;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import org.jspecify.annotations.Nullable;

/**
 * Admin payload for creating/updating a retail product. The limits mirror the V44 columns
 * ({@code name VARCHAR(100)}, {@code size_label VARCHAR(30)}, {@code price DECIMAL(10,2)}), so
 * oversize input is a 400 rather than a database error.
 */
public record RetailProductRequest(
        @NotBlank(message = "Product name is required") @Size(max = 100, message = "Product name must not exceed 100 characters") String name,

        @Size(max = 30, message = "Size must not exceed 30 characters") @Nullable String sizeLabel,

        @NotNull(message = "Price is required") @Positive(message = "Price must be positive") @Digits(integer = 8, fraction = 2, message = "Price must have at most 8 integer digits and 2 decimals") BigDecimal price,

        @NotNull(message = "Position is required") @Min(value = 0, message = "Position must not be negative") @Max(value = 9999, message = "Position must not exceed 9999") Integer sortOrder) {}
