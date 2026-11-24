package com.example.taskflow.catalog;

import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

/**
 * Owner payload for the promo strip. A blank or missing message turns the strip off. At most 120
 * characters (V45): the prerendered web page reserves room for that much text.
 */
public record AnnouncementRequest(
        @Size(max = 120, message = "The announcement must not exceed 120 characters") @Nullable String message) {}
