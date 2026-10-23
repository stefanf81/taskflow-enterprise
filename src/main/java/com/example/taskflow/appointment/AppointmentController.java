package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.access.prepost.PreAuthorize;

@RestController
@RequestMapping("/api/v1/appointments")
@Tag(name = "Barber Appointment Management System", description = "Operations for booking and approving appointments")
@Validated
public class AppointmentController {

    private final AppointmentService appointmentService;
    private final AppointmentEventStreamService eventStreamService;
    private final Clock clock;

    public AppointmentController(AppointmentService appointmentService, AppointmentEventStreamService eventStreamService,
                                 Clock clock) {
        this.appointmentService = appointmentService;
        this.eventStreamService = eventStreamService;
        this.clock = clock;
    }

    @GetMapping
    @Operation(summary = "View a list of scheduled appointments", description = "Can be filtered by status and customer name, with pagination.")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Successfully retrieved paginated appointments"),
            @ApiResponse(responseCode = "400", description = "Invalid filter (for example an unknown status) or pagination parameters")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<AppointmentDashboardResponse> getAllAppointments(
            @Parameter(description = "Filter by status (PENDING, APPROVED, DENIED, CANCELLED, or OVERDUE for past PENDING bookings)")
            @RequestParam(required = false) String status,
            @Parameter(description = "Search by customer name, e-mail or phone (contains, case-insensitive) or by exact public id")
            @RequestParam(required = false) String search,
            @Parameter(description = "Page number (0-indexed)")
            @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size")
            @RequestParam(defaultValue = "10") @Max(100) int size) {

        AppointmentDashboardResponse response = appointmentService.getAllAppointments(status, search, page, size);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().cachePrivate().mustRevalidate())
                .body(response);
    }

    @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Subscribe to administrator appointment update events")
    @PreAuthorize("hasRole('ADMIN')")
    public SseEmitter streamAppointmentEvents(Authentication authentication, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-cache");
        response.setHeader("X-Accel-Buffering", "no");
        // The stream outlives this request: hand over the token expiry so it is closed once the
        // token expires (non-JWT principals, e.g. in tests, simply have no expiry).
        // Also hand over the token id so the stream is closed when the token is revoked (logout).
        Instant tokenExpiresAt = authentication instanceof JwtAuthenticationToken jwt
                ? jwt.getToken().getExpiresAt() : null;
        String tokenId = authentication instanceof JwtAuthenticationToken jwt
                ? jwt.getToken().getId() : null;
        return eventStreamService.subscribe(authentication.getName(), tokenExpiresAt, tokenId);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get an appointment by its ID")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Successfully retrieved appointment"),
            @ApiResponse(responseCode = "404", description = "Appointment was not found")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<AppointmentResponse> getAppointmentById(
            @Parameter(description = "The database ID of the appointment")
            @PathVariable Long id) {

        AppointmentResponse appointment = appointmentService.getAppointmentById(id);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().cachePrivate().mustRevalidate())
                .body(appointment);
    }

    @GetMapping("/public/shop")
    @Operation(summary = "Get the shop's time zone, which decides what counts as past or bookable (Guest Access)")
    @ApiResponse(responseCode = "200", description = "Shop time zone returned")
    public ResponseEntity<ShopInfoResponse> getShopInfo() {
        // Changes only with a deployment: same 5 m public tier as the catalog.
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic())
                .body(new ShopInfoResponse(clock.getZone().getId()));
    }

    @GetMapping("/public/busy-slots")
    @Operation(summary = "Get a list of busy time slots for a specific barber on a specific date (Guest Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "List of busy time slots returned"),
            @ApiResponse(responseCode = "400", description = "Unknown barber or invalid date"),
            @ApiResponse(responseCode = "503", description = "Availability temporarily cannot be computed (database busy); retry shortly")
    })
    public ResponseEntity<java.util.List<String>> getBusySlots(
            @Parameter(description = "Barber name")
            @NotBlank(message = "Barber name is required")
            @Size(max = 100, message = "Barber name must not exceed 100 characters")
            @RequestParam String barberName,
            @Parameter(description = "Booking date (YYYY-MM-DD)")
            @NotBlank(message = "Booking date is required")
            @Pattern(regexp = "^\\d{4}-\\d{2}-\\d{2}$", message = "Date must be in YYYY-MM-DD format")
            @RequestParam String bookingDate,
            @Parameter(description = "Optional service name: slots where that service would overlap a later "
                    + "booking or run past closing time are also reported as busy")
            @Size(max = 100, message = "Service type must not exceed 100 characters")
            @RequestParam(required = false) String serviceType) {

        java.util.List<String> busySlots = appointmentService.getBusySlots(barberName, bookingDate, serviceType);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(30, TimeUnit.SECONDS).cachePrivate().mustRevalidate())
                .body(busySlots);
    }

    @PutMapping("/public/cancel/{publicId}")
    @Operation(summary = "Cancel an appointment securely as a guest by verifying the booking email (Guest Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "204", description = "Appointment cancelled (or already cancelled)"),
            @ApiResponse(responseCode = "400", description = "Invalid or mismatched email, declined booking, or booking already started"),
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
            @ApiResponse(responseCode = "200", description = "Idempotent replay — the Idempotency-Key already created this booking"),
            @ApiResponse(responseCode = "400", description = "Invalid request payload, off-grid or past time, too far ahead, too many upcoming bookings, or slot unavailable"),
            @ApiResponse(responseCode = "409", description = "Idempotency-Key already used for a different request")
    })
    public ResponseEntity<AppointmentResponse> createAppointment(
            @RequestHeader(value = "Idempotency-Key", required = false)
            @Size(max = 100, message = "Idempotency-Key must not exceed 100 characters")
            String idempotencyKey,
            @Valid @RequestBody AppointmentCreateRequest request) {

        AppointmentCreationResult result = appointmentService.createAppointment(request, idempotencyKey);
        HttpStatus status = result.replayed() ? HttpStatus.OK : HttpStatus.CREATED;
        return ResponseEntity.status(status).body(result.appointment());
    }

    @PutMapping("/{id}")
    @Operation(summary = "Approve or Deny an appointment status (Owner Admin Access)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Successfully updated appointment status"),
            @ApiResponse(responseCode = "400", description = "Invalid request payload provided"),
            @ApiResponse(responseCode = "404", description = "Appointment was not found"),
            @ApiResponse(responseCode = "409", description = "Transition not allowed, booking cannot be approved (no barber, past, slot taken), or concurrent modification")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<AppointmentResponse> updateAppointmentStatus(
            @Parameter(description = "The database ID of the appointment to update")
            @PathVariable Long id,
            @Valid @RequestBody AppointmentUpdateRequest request) {
        
        AppointmentResponse updatedAppointment = appointmentService.updateAppointmentStatus(id, request);
        return ResponseEntity.ok(updatedAppointment);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Cancel an appointment (soft cancel: the booking is kept with status CANCELLED)")
    @ApiResponses(value = {
            @ApiResponse(responseCode = "204", description = "Appointment cancelled (or already cancelled)"),
            @ApiResponse(responseCode = "400", description = "A declined appointment cannot be cancelled"),
            @ApiResponse(responseCode = "404", description = "Appointment was not found")
    })
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteAppointment(
            @Parameter(description = "The database ID of the appointment to delete")
            @PathVariable Long id) {
        
        appointmentService.deleteAppointment(id);
        return ResponseEntity.noContent().build();
    }
}
