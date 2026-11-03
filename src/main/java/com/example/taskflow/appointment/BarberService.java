package com.example.taskflow.appointment;

import java.util.List;

public interface BarberService {
    List<PublicBarberResponse> getPublicBarbers();
    List<BarberResponse> getAllBarbers();

    /** The shop's weekly hours, derived from the barbers' schedules (see {@link ShopInfoResponse}). */
    List<OpeningHoursResponse> getOpeningHours();
    BarberResponse createBarber(BarberRequest request);
    List<BarberTimeOffResponse> getTimeOff(Long barberId);
    BarberTimeOffResponse addTimeOff(Long barberId, BarberTimeOffRequest request);
}
