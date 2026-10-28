package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.security.access.prepost.PreAuthorize;

@RestController
@RequestMapping("/api/v1/barbers")
@Tag(name = "Barber Management", description = "Operations for managing barbers, schedules, and time-off")
class BarberController {

    private final BarberService barberService;
    private final Clock clock;

    public BarberController(BarberService barberService, Clock clock) {
        this.barberService = barberService;
        this.clock = clock;
    }

    @GetMapping
    @Operation(summary = "Get all barbers")
    @ApiResponse(responseCode = "200", description = "List of all barbers returned")
    public ResponseEntity<List<PublicBarberResponse>> getAllBarbers() {
        // Public barbers: 5m public cache, pairs with @Cacheable("publicBarbers") 10m
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic())
                .body(barberService.getPublicBarbers());
    }

    @GetMapping("/admin")
    @Operation(summary = "Get all barbers with administrative contact details")
    @ApiResponse(responseCode = "200", description = "List of all barbers returned")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<BarberResponse>> getAdminBarbers() {
        // Admin barbers: must-revalidate to avoid stale admin view, but allow ETag 304
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().cachePrivate().mustRevalidate())
                .body(barberService.getAllBarbers());
    }

    @PostMapping
    @Operation(summary = "Add a new barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Barber created successfully"),
            @ApiResponse(responseCode = "400", description = "Invalid barber data")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<BarberResponse> createBarber(@Valid @RequestBody BarberRequest request) {
        return new ResponseEntity<>(barberService.createBarber(request), HttpStatus.CREATED);
    }

    @GetMapping("/{barberId}/time-off")
    @Operation(summary = "Get time-off for a barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "List of time-off periods returned"),
            @ApiResponse(responseCode = "404", description = "Barber not found")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<BarberTimeOffResponse>> getTimeOff(@Parameter(description = "Barber database ID") @PathVariable Long barberId) {
        return ResponseEntity.ok(barberService.getTimeOff(barberId));
    }

    @PostMapping("/{barberId}/time-off")
    @Operation(summary = "Add time-off for a barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Time-off period created"),
            @ApiResponse(responseCode = "400", description = "Invalid time-off data"),
            @ApiResponse(responseCode = "404", description = "Barber not found")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<BarberTimeOffResponse> addTimeOff(@Parameter(description = "Barber database ID") @PathVariable Long barberId, @Valid @RequestBody BarberTimeOffRequest request) {
        // Today is the shop's today (app.shop.time-zone), not the JVM's.
        if (request.startDate().isBefore(LocalDate.now(clock))) {
            throw new IllegalArgumentException("Start date must be today or in the future.");
        }
        return new ResponseEntity<>(barberService.addTimeOff(barberId, request), HttpStatus.CREATED);
    }
}
