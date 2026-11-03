/**
 * Appointments, barbers, schedules, time off, availability and the admin event stream. Other modules see AppointmentService (four cross-module methods), AppointmentDetails, AppointmentStatus and the status/cancellation events; the Appointment entity, repositories, controllers and the booking, lifecycle and query services stay internal.
 */
@ApplicationModule(allowedDependencies = {"catalog", "core", "core :: cache", "appointment.stream"})
package com.example.taskflow.appointment;

import org.springframework.modulith.ApplicationModule;
