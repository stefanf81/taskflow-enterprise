package com.example.taskflow.appointment;

import org.springframework.context.ApplicationEvent;

public class AppointmentStatusChangedEvent extends ApplicationEvent {
    private final AppointmentDetails appointment;

    public AppointmentStatusChangedEvent(Object source, AppointmentDetails appointment) {
        super(source);
        this.appointment = appointment;
    }

    public AppointmentDetails getAppointment() {
        return appointment;
    }
}
