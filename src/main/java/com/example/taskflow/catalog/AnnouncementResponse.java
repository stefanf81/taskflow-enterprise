package com.example.taskflow.catalog;

import org.jspecify.annotations.Nullable;

/**
 * The landing pages' promo strip.
 *
 * @param active  whether a strip is shown (a message is set)
 * @param message the strip's text; absent when {@code active} is false
 */
public record AnnouncementResponse(
        boolean active,
        // Omitted from the JSON when null (spring.jackson.default-property-inclusion=non_null).
        @Nullable String message) {
    static AnnouncementResponse of(@Nullable String message) {
        return new AnnouncementResponse(message != null, message);
    }
}
