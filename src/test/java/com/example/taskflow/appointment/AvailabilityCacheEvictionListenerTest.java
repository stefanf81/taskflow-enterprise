package com.example.taskflow.appointment;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AvailabilityCacheEvictionListenerTest {

    @Mock
    private AppointmentStatsService statsService;

    @InjectMocks
    private AvailabilityCacheEvictionListener listener;

    @Test
    void singleDate_shouldEvictConcreteAndSentinelAndStats() {
        listener.onAvailabilityChanged(AvailabilityChangedEvent.single("Alex", LocalDate.of(2026, 5, 16)));

        verify(statsService).clearAvailabilityCache("Alex", LocalDate.of(2026, 5, 16));
        verify(statsService).clearStatsCache();
        verify(statsService, never()).clearAllBusySlotsCache();
    }

    @Test
    void range_shouldEvictEveryDateInclusive() {
        listener.onAvailabilityChanged(
                AvailabilityChangedEvent.range("Alex", LocalDate.of(2026, 5, 16), LocalDate.of(2026, 5, 18)));

        verify(statsService).clearAvailabilityCache("Alex", LocalDate.of(2026, 5, 16));
        verify(statsService).clearAvailabilityCache("Alex", LocalDate.of(2026, 5, 17));
        verify(statsService).clearAvailabilityCache("Alex", LocalDate.of(2026, 5, 18));
        verify(statsService, times(3)).clearAvailabilityCache(anyString(), any(LocalDate.class));
    }

    @Test
    void range_shouldCapAt366Days() {
        LocalDate start = LocalDate.of(2026, 1, 1);
        listener.onAvailabilityChanged(AvailabilityChangedEvent.range("Alex", start, start.plusDays(399)));

        verify(statsService, times(366)).clearAvailabilityCache(anyString(), any(LocalDate.class));
    }

    @Test
    void allBarbers_shouldInvalidateWholeCacheAndStats() {
        listener.onAvailabilityChanged(AvailabilityChangedEvent.allBarbers());

        verify(statsService).clearAllBusySlotsCache();
        verify(statsService).clearStatsCache();
        verify(statsService, never()).clearAvailabilityCache(anyString(), any(LocalDate.class));
    }

    @Test
    void evictionFailure_shouldBeSwallowed() {
        doThrow(new IllegalStateException("Redis down"))
                .when(statsService).clearAvailabilityCache(anyString(), any(LocalDate.class));

        assertDoesNotThrow(() -> listener.onAvailabilityChanged(
                AvailabilityChangedEvent.single("Alex", LocalDate.of(2026, 5, 16))));
    }
}
