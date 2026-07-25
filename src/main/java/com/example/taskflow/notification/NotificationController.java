package com.example.taskflow.notification;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/notifications")
@Tag(name = "Notification Outbox", description = "View history of sent SMS/Emails")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    @Operation(summary = "Get all notifications (Admin Only)")
    @ApiResponse(responseCode = "200", description = "List of notifications returned (newest first, capped at top 100)")
    public ResponseEntity<List<NotificationOutboxResponse>> getNotifications() {
        return ResponseEntity.ok(notificationService.getRecentNotifications());
    }
}
