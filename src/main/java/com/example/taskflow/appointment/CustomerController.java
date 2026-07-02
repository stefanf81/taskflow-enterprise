package com.example.taskflow.appointment;

import com.example.taskflow.core.ResourceNotFoundException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/customer")
@CrossOrigin(origins = "${app.cors.allowed-origins:*}")
@Tag(name = "Customer Dashboard", description = "Endpoints for logged-in customers")
public class CustomerController {

    private final AppointmentRepository appointmentRepository;
    private final AppointmentService appointmentService;

    public CustomerController(AppointmentRepository appointmentRepository, AppointmentService appointmentService) {
        this.appointmentRepository = appointmentRepository;
        this.appointmentService = appointmentService;
    }

    @GetMapping("/appointments")
    @Operation(summary = "Get all appointments for the logged-in customer")
    public ResponseEntity<Page<AppointmentResponse>> getMyAppointments(
            Authentication authentication,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        
        String email = authentication.getName();
        Pageable pageable = PageRequest.of(page, size, Sort.by("bookingDate").descending());
        
        Page<Appointment> itemPage = appointmentRepository.findByCustomerEmailIgnoreCase(email, pageable);
        return ResponseEntity.ok(itemPage.map(AppointmentResponse::fromEntity));
    }

    @DeleteMapping("/appointments/{id}")
    @Operation(summary = "Cancel my appointment")
    public ResponseEntity<Void> cancelMyAppointment(@PathVariable Long id, Authentication authentication) {
        String email = authentication.getName();
        Appointment appointment = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found or unauthorized."));
        
        if (!appointment.getCustomerEmail().equalsIgnoreCase(email)) {
            throw new ResourceNotFoundException("Appointment not found or unauthorized.");
        }

        appointmentService.deleteAppointment(id);
        return ResponseEntity.noContent().build();
    }
}
