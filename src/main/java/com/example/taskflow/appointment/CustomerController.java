package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import org.springframework.data.domain.Page;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/customer")
@Tag(name = "Customer Dashboard", description = "Endpoints for logged-in customers")
@Validated
public class CustomerController {

    private final AppointmentService appointmentService;

    public CustomerController(AppointmentService appointmentService) {
        this.appointmentService = appointmentService;
    }

    @GetMapping("/appointments")
    @Operation(summary = "Get all appointments for the logged-in customer")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Paginated appointments returned"),
            @ApiResponse(responseCode = "401", description = "Not authenticated")
    })
    public ResponseEntity<Page<AppointmentResponse>> getMyAppointments(
            Authentication authentication,
            @Parameter(description = "Page number (0-indexed)") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size") @RequestParam(defaultValue = "10") @Max(100) int size) {
        String email = authentication.getName();
        // Private, must-revalidate — appointments mutate frequently; ETag handles 304
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().cachePrivate().mustRevalidate())
                .body(appointmentService.getMyAppointments(email, page, size));
    }

    @DeleteMapping("/appointments/{publicId}")
    @Operation(summary = "Cancel my appointment")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "204", description = "Appointment cancelled successfully"),
            @ApiResponse(responseCode = "401", description = "Not authenticated"),
            @ApiResponse(responseCode = "404", description = "Appointment not found or not owned by user")
    })
    public ResponseEntity<Void> cancelMyAppointment(@Parameter(description = "Appointment public UUID") @PathVariable String publicId, Authentication authentication) {
        String email = authentication.getName();
        appointmentService.cancelMyAppointment(publicId, email);
        return ResponseEntity.noContent().build();
    }
}
