package com.example.taskflow.appointment;

import java.util.List;

public interface BarberService {
    List<BarberResponse> getAllBarbers();
    Barber createBarber(BarberRequest request);
    List<BarberTimeOff> getTimeOff(Long barberId);
    BarberTimeOff addTimeOff(Long barberId, BarberTimeOffRequest request);
}
