/**
 * Appointments, barbers, schedules, time off, availability and the admin event stream. Other modules see AppointmentService, AppointmentDetails, AppointmentStatus and the status/cancellation events; the Appointment entity, repositories and controllers stay internal.
 */
@ApplicationModule(allowedDependencies = {"catalog", "core"})
package com.example.taskflow.appointment;

import org.springframework.modulith.ApplicationModule;
