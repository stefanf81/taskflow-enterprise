package com.example.todoapi.appointment;

import org.springframework.context.ApplicationEvent;

public class AppointmentStatusChangedEvent extends ApplicationEvent {
    private final Appointment appointment;

    public AppointmentStatusChangedEvent(Object source, Appointment appointment) {
        super(source);
        this.appointment = appointment;
    }

    public Appointment getAppointment() {
        return appointment;
    }
}