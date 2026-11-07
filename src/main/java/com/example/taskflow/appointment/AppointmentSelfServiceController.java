package com.example.taskflow.appointment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

/** Isolated handlers so existing appointment/customer controllers retain their stable contract. */
@RestController
class AppointmentSelfServiceController {
    private final AppointmentCalendarService calendar;
    private final AppointmentReschedulingService rescheduling;

    AppointmentSelfServiceController(AppointmentCalendarService calendar, AppointmentReschedulingService rescheduling) {
        this.calendar = calendar;
        this.rescheduling = rescheduling;
    }

    @PostMapping("/api/v1/appointments/public/calendar/{publicId}")
    @Operation(summary = "Export a guest appointment as an iCalendar file after email verification")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Calendar content and suggested .ics filename"),
            @ApiResponse(responseCode = "400", description = "Invalid email"),
            @ApiResponse(responseCode = "404", description = "Booking not found or verification failed"),
            @ApiResponse(responseCode = "409", description = "Declined or cancelled booking")})
    public ResponseEntity<CalendarExportResponse> guestCalendar(@PathVariable String publicId,
            @Valid @RequestBody CalendarExportRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(calendar.export(publicId, request.email()));
    }

    @GetMapping("/api/v1/customer/appointments/{publicId}/calendar")
    @PreAuthorize("hasAnyRole('CUSTOMER', 'ADMIN')")
    @Operation(summary = "Export my appointment as an iCalendar file")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Calendar content and suggested .ics filename"),
            @ApiResponse(responseCode = "404", description = "Booking not found or not owned by user"),
            @ApiResponse(responseCode = "409", description = "Declined or cancelled booking")})
    public ResponseEntity<CalendarExportResponse> customerCalendar(@PathVariable String publicId,
            Authentication authentication) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(calendar.export(publicId, authentication.getName()));
    }

    @PostMapping("/api/v1/appointments/public/reschedule/{publicId}/availability")
    @Operation(summary = "Busy start times of a day for moving a guest booking, after email verification "
            + "(its own barber and booked length; the booking itself does not count)")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Start times the booking cannot move to"),
            @ApiResponse(responseCode = "400", description = "Invalid email or date"),
            @ApiResponse(responseCode = "404", description = "Booking not found or verification failed"),
            @ApiResponse(responseCode = "409", description = "Booking cannot be rescheduled")})
    public ResponseEntity<List<String>> guestRescheduleAvailability(@PathVariable String publicId,
            @Valid @RequestBody RescheduleAvailabilityRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(rescheduling.busySlots(publicId, request.email(), request.bookingDate()));
    }

    @GetMapping("/api/v1/customer/appointments/{publicId}/availability")
    @PreAuthorize("hasAnyRole('CUSTOMER', 'ADMIN')")
    @Operation(summary = "Busy start times of a day for moving my booking "
            + "(its own barber and booked length; the booking itself does not count)")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Start times the booking cannot move to"),
            @ApiResponse(responseCode = "400", description = "Invalid date"),
            @ApiResponse(responseCode = "404", description = "Booking not found or not owned by user"),
            @ApiResponse(responseCode = "409", description = "Booking cannot be rescheduled")})
    public ResponseEntity<List<String>> customerRescheduleAvailability(@PathVariable String publicId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate bookingDate,
            Authentication authentication) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(rescheduling.busySlots(publicId, authentication.getName(), bookingDate));
    }

    @PutMapping("/api/v1/appointments/public/reschedule/{publicId}")
    @Operation(summary = "Reschedule a guest booking after email verification (same barber and service)")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Appointment moved; approval is pending again"),
            @ApiResponse(responseCode = "400", description = "Invalid slot or outside booking window"),
            @ApiResponse(responseCode = "404", description = "Booking not found or verification failed"),
            @ApiResponse(responseCode = "409", description = "Booking cannot move, slot unavailable, or concurrent change")})
    public ResponseEntity<AppointmentResponse> guestReschedule(@PathVariable String publicId,
            @Valid @RequestBody GuestRescheduleRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(rescheduling.reschedule(publicId,
                request.email(), request.slot(), AppointmentRescheduledEvent.RescheduledBy.GUEST));
    }

    @PutMapping("/api/v1/customer/appointments/{publicId}/reschedule")
    @PreAuthorize("hasAnyRole('CUSTOMER', 'ADMIN')")
    @Operation(summary = "Reschedule my booking (same barber and service)")
    @ApiResponses({@ApiResponse(responseCode = "200", description = "Appointment moved; approval is pending again"),
            @ApiResponse(responseCode = "400", description = "Invalid slot or outside booking window"),
            @ApiResponse(responseCode = "404", description = "Booking not found or not owned by user"),
            @ApiResponse(responseCode = "409", description = "Booking cannot move, slot unavailable, or concurrent change")})
    public ResponseEntity<AppointmentResponse> customerReschedule(@PathVariable String publicId,
            @Valid @RequestBody RescheduleRequest request, Authentication authentication) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(rescheduling.reschedule(publicId,
                authentication.getName(), request, AppointmentRescheduledEvent.RescheduledBy.CUSTOMER));
    }
}
