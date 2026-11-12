package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.domain.Page;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.access.prepost.PreAuthorize;

@RestController
@RequestMapping("/api/v1/customer")
@Tag(name = "Customer Dashboard", description = "Endpoints for logged-in customers")
@Validated
@PreAuthorize("hasAnyRole('CUSTOMER', 'ADMIN')")
class CustomerController {

    private final AppointmentQueryService queryService;
    private final AppointmentLifecycleService lifecycleService;

    public CustomerController(AppointmentQueryService queryService, AppointmentLifecycleService lifecycleService) {
        this.queryService = queryService;
        this.lifecycleService = lifecycleService;
    }

    @GetMapping("/appointments")
    @Operation(summary = "Get all appointments for the logged-in customer")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Paginated appointments returned"),
            @ApiResponse(responseCode = "400", description = "Invalid pagination parameters"),
            @ApiResponse(responseCode = "401", description = "Not authenticated")
    })
    public ResponseEntity<Page<AppointmentResponse>> getMyAppointments(
            Authentication authentication,
            @Parameter(description = "Page number (0-indexed)") @RequestParam(defaultValue = "0") @Min(0) int page,
            @Parameter(description = "Page size") @RequestParam(defaultValue = "10") @Min(1) @Max(100) int size) {
        String email = authentication.getName();
        // no-store: the customer's own bookings must not stay in the device HTTP cache after logout
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(queryService.getMyAppointments(email, page, size));
    }

    @DeleteMapping("/appointments/{publicId}")
    @Operation(summary = "Cancel my appointment")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "204", description = "Appointment cancelled (or already cancelled)"),
            @ApiResponse(responseCode = "400", description = "Declined booking, or booking already started"),
            @ApiResponse(responseCode = "401", description = "Not authenticated"),
            @ApiResponse(responseCode = "404", description = "Appointment not found or not owned by user")
    })
    public ResponseEntity<Void> cancelMyAppointment(@Parameter(description = "Appointment public UUID") @PathVariable String publicId, Authentication authentication) {
        String email = authentication.getName();
        lifecycleService.cancelMyAppointment(publicId, email);
        return ResponseEntity.noContent().build();
    }
}
