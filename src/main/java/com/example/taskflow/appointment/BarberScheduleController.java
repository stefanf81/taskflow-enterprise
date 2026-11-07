package com.example.taskflow.appointment;

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
    public ResponseEntity<BarberScheduleResponse> get(@PathVariable Long barberId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.get(barberId));
    }

    @PostMapping("/preview")
    public SchedulePreviewResponse preview(@PathVariable Long barberId, @Valid @RequestBody ScheduleChangeRequest request) {
        return service.preview(barberId, request);
    }

    @PutMapping
    public BarberScheduleResponse update(@PathVariable Long barberId, @Valid @RequestBody ScheduleChangeRequest request) {
        return service.update(barberId, request);
    }
}
