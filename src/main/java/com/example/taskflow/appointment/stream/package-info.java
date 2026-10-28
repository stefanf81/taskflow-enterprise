/**
 * Admin Server-Sent Events: fans {@link com.example.taskflow.appointment.stream.AppointmentAdminEvent}s
 * out to the connected admin dashboards and closes streams whose token expired or was revoked.
 * A nested module of {@code appointment}: it depends on nothing but {@code core}; the parent only
 * publishes its event and subscribes controllers through {@code AppointmentEventStreamService}.
 */
@ApplicationModule(displayName = "Admin event stream", allowedDependencies = {"core"})
package com.example.taskflow.appointment.stream;

import org.springframework.modulith.ApplicationModule;
