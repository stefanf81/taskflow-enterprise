package com.example.taskflow.appointment;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;

import java.time.LocalDate;

/**
 * Dedicated service for appointment statistics caching.
 * Extracted from {@link AppointmentServiceImpl} to reduce its dependency count
 * and keep caching concerns isolated.
 */
@Service
public class AppointmentStatsService {

    private final CacheManager cacheManager;

    public AppointmentStatsService(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    public AppointmentStats getStatsCached(AppointmentRepository appointmentRepository) {
        Cache cache = cacheManager.getCache("appointmentStats");
        if (cache != null) {
            return cache.get(LocalDate.now(), () -> appointmentRepository.getAppointmentStats(LocalDate.now()));
        }
        return appointmentRepository.getAppointmentStats(LocalDate.now());
    }

    public void clearStatsCache() {
        Cache cache = cacheManager.getCache("appointmentStats");
        if (cache != null) {
            cache.evict(LocalDate.now());
        }
    }

    public void clearBusySlotsCache(String barberName, LocalDate bookingDate) {
        Cache cache = cacheManager.getCache("busySlots");
        if (cache != null) {
            cache.evict(barberName + "-" + bookingDate);
        }
    }
}
