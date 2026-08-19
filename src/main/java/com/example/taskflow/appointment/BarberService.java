package com.example.taskflow.appointment;

import java.util.List;

public interface BarberService {
    List<PublicBarberResponse> getPublicBarbers();
    List<BarberResponse> getAllBarbers();
    BarberResponse createBarber(BarberRequest request);
    List<BarberTimeOffResponse> getTimeOff(Long barberId);
    BarberTimeOffResponse addTimeOff(Long barberId, BarberTimeOffRequest request);
}
