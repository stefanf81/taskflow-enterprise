package com.example.taskflow.catalog;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The owner's edit of the promo strip. Guests read it from {@code GET /api/v1/appointments/public/shop}
 * ({@code announcement}); the write sits under the catalog's admin-only {@code /**} rules.
 */
@RestController
@RequestMapping("/api/v1/catalog/announcement")
@Tag(name = "Shop Announcement", description = "The promo strip at the top of the landing pages")
class ShopAnnouncementController {

    private final ShopAnnouncementService announcements;

    ShopAnnouncementController(ShopAnnouncementService announcements) {
        this.announcements = announcements;
    }

    @PutMapping
    @Operation(summary = "Set the landing pages' announcement; a blank message turns it off (Admin Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Announcement saved"),
            @ApiResponse(responseCode = "400", description = "Message longer than 120 characters")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<AnnouncementResponse> updateAnnouncement(@Valid @RequestBody AnnouncementRequest request) {
        return ResponseEntity.ok(announcements.update(request));
    }
}
