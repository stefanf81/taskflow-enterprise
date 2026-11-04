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
        LocalDate date = LocalDate.of(2026, 5, 16);
        listener.onAvailabilityChanged(AvailabilityChangedEvent.single("Alex", date));

        verify(statsService).clearAvailabilityCache("Alex", date, date);
        verify(statsService).clearStatsCache();
        verify(statsService, never()).clearAllBusySlotsCache();
    }

    /** The whole range goes over in one call, which reads the catalog once and clamps it to the booking window. */
    @Test
    void range_isHandedOverInOneCall() {
        listener.onAvailabilityChanged(
                AvailabilityChangedEvent.range("Alex", LocalDate.of(2026, 5, 16), LocalDate.of(2026, 8, 18)));

        verify(statsService).clearAvailabilityCache("Alex", LocalDate.of(2026, 5, 16), LocalDate.of(2026, 8, 18));
        verify(statsService, times(1)).clearAvailabilityCache(anyString(), any(LocalDate.class), any(LocalDate.class));
        verify(statsService).clearStatsCache();
    }

    @Test
    void allBarbers_shouldInvalidateWholeCacheAndStats() {
        listener.onAvailabilityChanged(AvailabilityChangedEvent.allBarbers());

        verify(statsService).clearAllBusySlotsCache();
        verify(statsService).clearStatsCache();
        verify(statsService, never()).clearAvailabilityCache(anyString(), any(LocalDate.class), any(LocalDate.class));
    }

    @Test
    void evictionFailure_shouldBeSwallowed() {
        doThrow(new IllegalStateException("Redis down"))
                .when(statsService).clearAvailabilityCache(anyString(), any(LocalDate.class), any(LocalDate.class));

        assertDoesNotThrow(() -> listener.onAvailabilityChanged(
                AvailabilityChangedEvent.single("Alex", LocalDate.of(2026, 5, 16))));
    }
}
