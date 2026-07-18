package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/customer")
@CrossOrigin(origins = "${app.cors.allowed-origins:*}")
@Tag(name = "Customer Dashboard", description = "Endpoints for logged-in customers")
public class CustomerController {

    private final AppointmentService appointmentService;

    public CustomerController(AppointmentService appointmentService) {
        this.appointmentService = appointmentService;
    }

    @GetMapping("/appointments")
    @Operation(summary = "Get all appointments for the logged-in customer")
    public ResponseEntity<Page<AppointmentResponse>> getMyAppointments(
            Authentication authentication,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        String email = authentication.getName();
        return ResponseEntity.ok(appointmentService.getMyAppointments(email, page, size));
    }

    @DeleteMapping("/appointments/{id}")
    @Operation(summary = "Cancel my appointment")
    public ResponseEntity<Void> cancelMyAppointment(@PathVariable Long id, Authentication authentication) {
        String email = authentication.getName();
        appointmentService.cancelMyAppointment(id, email);
        return ResponseEntity.noContent().build();
    }
}
