package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/barbers")
@CrossOrigin(origins = "${app.cors.allowed-origins:*}")
@Tag(name = "Barber Management", description = "Operations for managing barbers, schedules, and time-off")
public class BarberController {

    private final BarberRepository barberRepository;
    private final BarberScheduleRepository scheduleRepository;
    private final BarberTimeOffRepository timeOffRepository;

    public BarberController(BarberRepository barberRepository, 
                            BarberScheduleRepository scheduleRepository, 
                            BarberTimeOffRepository timeOffRepository) {
        this.barberRepository = barberRepository;
        this.scheduleRepository = scheduleRepository;
        this.timeOffRepository = timeOffRepository;
    }

    @GetMapping
    @Operation(summary = "Get all barbers")
    @ApiResponse(responseCode = "200", description = "List of all barbers returned")
    public ResponseEntity<List<Barber>> getAllBarbers() {
        return ResponseEntity.ok(barberRepository.findAll());
    }

    @PostMapping
    @Operation(summary = "Add a new barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Barber created successfully"),
            @ApiResponse(responseCode = "400", description = "Invalid barber data")
    })
    public ResponseEntity<Barber> createBarber(@RequestBody Barber barber) {
        return new ResponseEntity<>(barberRepository.save(barber), HttpStatus.CREATED);
    }

    @GetMapping("/{barberId}/time-off")
    @Operation(summary = "Get time-off for a barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "List of time-off periods returned"),
            @ApiResponse(responseCode = "404", description = "Barber not found")
    })
    public ResponseEntity<List<BarberTimeOff>> getTimeOff(@Parameter(description = "Barber database ID") @PathVariable Long barberId) {
        List<BarberTimeOff> timeOffs = timeOffRepository.findByBarberId(barberId);
        return ResponseEntity.ok(timeOffs);
    }

    @PostMapping("/{barberId}/time-off")
    @Operation(summary = "Add time-off for a barber")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Time-off period created"),
            @ApiResponse(responseCode = "400", description = "Invalid time-off data"),
            @ApiResponse(responseCode = "404", description = "Barber not found")
    })
    public ResponseEntity<BarberTimeOff> addTimeOff(@Parameter(description = "Barber database ID") @PathVariable Long barberId, @RequestBody BarberTimeOff timeOff) {
        Barber barber = barberRepository.findById(barberId)
                .orElseThrow(() -> new ResourceNotFoundException("Barber not found with id: " + barberId));
        timeOff.setBarber(barber);
        return new ResponseEntity<>(timeOffRepository.save(timeOff), HttpStatus.CREATED);
    }
}
