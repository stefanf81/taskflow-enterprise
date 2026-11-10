package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/barbers/{barberId}/schedule")
@PreAuthorize("hasRole('ADMIN')")
class BarberScheduleController {
    private final BarberScheduleService service;

    BarberScheduleController(BarberScheduleService service) { this.service = service; }

    @GetMapping
    @Operation(summary = "Get a barber's weekly schedule")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Weekly schedule returned"),
            @ApiResponse(responseCode = "404", description = "Barber not found")
    })
    public ResponseEntity<BarberScheduleResponse> get(@PathVariable Long barberId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.get(barberId));
    }

    @PostMapping("/preview")
    @Operation(summary = "Preview booking conflicts for a weekly schedule change")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Conflict preview returned"),
            @ApiResponse(responseCode = "400", description = "Invalid schedule"),
            @ApiResponse(responseCode = "404", description = "Barber not found"),
            @ApiResponse(responseCode = "409", description = "Schedule revision changed")
    })
    public SchedulePreviewResponse preview(@PathVariable Long barberId, @Valid @RequestBody ScheduleChangeRequest request) {
        return service.preview(barberId, request);
    }

    @PutMapping
    @Operation(summary = "Update a barber's weekly schedule")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Weekly schedule updated"),
            @ApiResponse(responseCode = "400", description = "Invalid schedule"),
            @ApiResponse(responseCode = "404", description = "Barber not found"),
            @ApiResponse(responseCode = "409", description = "Schedule revision changed or conflicting bookings not confirmed")
    })
    public BarberScheduleResponse update(@PathVariable Long barberId, @Valid @RequestBody ScheduleChangeRequest request) {
        return service.update(barberId, request);
    }
}
