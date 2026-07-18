package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.validation.annotation.Validated;

@RestController
@RequestMapping("/api/v1/appointments")
@CrossOrigin(origins = "${app.cors.allowed-origins:*}")
@Tag(name = "Barber Appointment Management System", description = "Operations for booking and approving appointments")
@Validated
public class AppointmentController {

    private final AppointmentService appointmentService;

    public AppointmentController(AppointmentService appointmentService) {
        this.appointmentService = appointmentService;
    }

    @GetMapping
    @Operation(summary = "View a list of scheduled appointments", description = "Can be filtered by status and customer name, with pagination.")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Successfully retrieved paginated appointments"),
            @ApiResponse(responseCode = "400", description = "Invalid filter or pagination parameters")
    })
    public ResponseEntity<AppointmentDashboardResponse> getAllAppointments(
            @Parameter(description = "Filter by status (PENDING, APPROVED, DENIED)")
            @RequestParam(required = false) String status,
            @Parameter(description = "Search customer name")
            @RequestParam(required = false) String search,
            @Parameter(description = "Page number (0-indexed)")
            @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size")
            @RequestParam(defaultValue = "10") int size) {
        
        AppointmentDashboardResponse response = appointmentService.getAllAppointments(status, search, page, size);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get an appointment by its ID")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Successfully retrieved appointment"),
            @ApiResponse(responseCode = "404", description = "Appointment was not found")
    })
    public ResponseEntity<AppointmentResponse> getAppointmentById(
            @Parameter(description = "The database ID of the appointment")
            @PathVariable Long id) {
        
        AppointmentResponse appointment = appointmentService.getAppointmentById(id);
        return ResponseEntity.ok(appointment);
    }

    @GetMapping("/public/busy-slots")
    @Operation(summary = "Get a list of busy time slots for a specific barber on a specific date (Guest Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "List of busy time slots returned"),
            @ApiResponse(responseCode = "400", description = "Invalid barber name or date format")
    })
    public ResponseEntity<java.util.List<String>> getBusySlots(
            @Parameter(description = "Barber name")
            @NotBlank(message = "Barber name is required")
            @Size(max = 100, message = "Barber name must not exceed 100 characters")
            @RequestParam String barberName,
            @Parameter(description = "Booking date (YYYY-MM-DD)")
            @NotBlank(message = "Booking date is required")
            @Pattern(regexp = "^\\d{4}-\\d{2}-\\d{2}$", message = "Date must be in YYYY-MM-DD format")
            @RequestParam String bookingDate) {
        
        java.util.List<String> busySlots = appointmentService.getBusySlots(barberName, bookingDate);
        return ResponseEntity.ok(busySlots);
    }

    @PutMapping("/public/cancel/{publicId}")
    @Operation(summary = "Cancel an appointment securely as a guest by verifying the booking email (Guest Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "204", description = "Appointment successfully cancelled"),
            @ApiResponse(responseCode = "400", description = "Invalid or mismatched email"),
            @ApiResponse(responseCode = "404", description = "Appointment with given public ID not found")
    })
    public ResponseEntity<Void> publicCancelAppointment(
            @Parameter(description = "The public UUID of the appointment")
            @PathVariable String publicId,
            @Valid @RequestBody CancelRequest request) {
        appointmentService.publicCancelAppointment(publicId, request.email());
        return ResponseEntity.noContent().build();
    }

    @PostMapping
    @Operation(summary = "Create/Book a new appointment (Guest Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "201", description = "Successfully booked appointment"),
            @ApiResponse(responseCode = "400", description = "Invalid request payload provided")
    })
    public ResponseEntity<AppointmentResponse> createAppointment(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody AppointmentCreateRequest request) {
        
        AppointmentResponse createdAppointment = appointmentService.createAppointment(request, idempotencyKey);
        return new ResponseEntity<>(createdAppointment, HttpStatus.CREATED);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Approve or Deny an appointment status (Owner Admin Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Successfully updated appointment status"),
            @ApiResponse(responseCode = "400", description = "Invalid request payload provided"),
            @ApiResponse(responseCode = "404", description = "Appointment was not found")
    })
    public ResponseEntity<AppointmentResponse> updateAppointmentStatus(
            @Parameter(description = "The database ID of the appointment to update")
            @PathVariable Long id,
            @Valid @RequestBody AppointmentUpdateRequest request) {
        
        AppointmentResponse updatedAppointment = appointmentService.updateAppointmentStatus(id, request);
        return ResponseEntity.ok(updatedAppointment);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete/Cancel an appointment")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "204", description = "Successfully deleted appointment"),
            @ApiResponse(responseCode = "404", description = "Appointment was not found")
    })
    public ResponseEntity<Void> deleteAppointment(
            @Parameter(description = "The database ID of the appointment to delete")
            @PathVariable Long id) {
        
        appointmentService.deleteAppointment(id);
        return ResponseEntity.noContent().build();
    }
}
