package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
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
    public ResponseEntity<List<Barber>> getAllBarbers() {
        return ResponseEntity.ok(barberRepository.findAll());
    }

    @PostMapping
    @Operation(summary = "Add a new barber")
    public ResponseEntity<Barber> createBarber(@RequestBody Barber barber) {
        return new ResponseEntity<>(barberRepository.save(barber), HttpStatus.CREATED);
    }

    @GetMapping("/{barberId}/time-off")
    @Operation(summary = "Get time-off for a barber")
    public ResponseEntity<List<BarberTimeOff>> getTimeOff(@PathVariable Long barberId) {
        List<BarberTimeOff> timeOffs = timeOffRepository.findByBarberId(barberId);
        return ResponseEntity.ok(timeOffs);
    }

    @PostMapping("/{barberId}/time-off")
    @Operation(summary = "Add time-off for a barber")
    public ResponseEntity<BarberTimeOff> addTimeOff(@PathVariable Long barberId, @RequestBody BarberTimeOff timeOff) {
        Barber barber = barberRepository.findById(barberId).orElseThrow();
        timeOff.setBarber(barber);
        return new ResponseEntity<>(timeOffRepository.save(timeOff), HttpStatus.CREATED);
    }
}
