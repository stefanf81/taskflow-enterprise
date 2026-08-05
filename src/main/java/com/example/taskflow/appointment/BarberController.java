package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/barbers")
@Tag(name = "Barber Management", description = "Operations for managing barbers, schedules, and time-off")
public class BarberController {

    private final BarberService barberService;

    public BarberController(BarberService barberService) {
        this.barberService = barberService;
    }

    @GetMapping
    @Operation(summary = "Get all barbers")
    @ApiResponse(responseCode = "200", description = "List of all barbers returned")
    public ResponseEntity<List<BarberResponse>> getAllBarbers() {
        return ResponseEntity.ok(barberService.getAllBarbers());
    }

    @PostMapping
    @Operation(summary = "Add a new barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Barber created successfully"),
            @ApiResponse(responseCode = "400", description = "Invalid barber data")
    })
    public ResponseEntity<BarberResponse> createBarber(@Valid @RequestBody BarberRequest request) {
        return new ResponseEntity<>(barberService.createBarber(request), HttpStatus.CREATED);
    }

    @GetMapping("/{barberId}/time-off")
    @Operation(summary = "Get time-off for a barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "List of time-off periods returned"),
            @ApiResponse(responseCode = "404", description = "Barber not found")
    })
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
    public ResponseEntity<BarberTimeOffResponse> addTimeOff(@Parameter(description = "Barber database ID") @PathVariable Long barberId, @Valid @RequestBody BarberTimeOffRequest request) {
        return new ResponseEntity<>(barberService.addTimeOff(barberId, request), HttpStatus.CREATED);
    }
}
