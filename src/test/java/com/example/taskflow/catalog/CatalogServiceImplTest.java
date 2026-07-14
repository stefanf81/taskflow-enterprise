package com.example.taskflow.catalog;

import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CatalogServiceImplTest {

    @Mock
    private ServiceItemRepository repository;

    @InjectMocks
    private CatalogServiceImpl catalogService;

    private ServiceItem item1;
    private ServiceItem item2;
    private ServiceItemRequest request;

    @BeforeEach
    void setUp() {
        item1 = new ServiceItem("Haircut", BigDecimal.valueOf(30.0), 30, "Hair", "Basic haircut");
        item1.setId(1L);

        item2 = new ServiceItem("Shave", BigDecimal.valueOf(20.0), 20, "Beard", "Classic shave");
        item2.setId(2L);

        request = new ServiceItemRequest("New Haircut", BigDecimal.valueOf(35.0), 45, "Hair", "Premium haircut");
    }

    @Test
    void testGetAllServices() {
        when(repository.findAll()).thenReturn(Arrays.asList(item1, item2));

        List<ServiceItemResponse> result = catalogService.getAllServices();

        assertNotNull(result);
        assertEquals(2, result.size());
        assertEquals("Haircut", result.get(0).name());
        assertEquals("Shave", result.get(1).name());
        verify(repository, times(1)).findAll();
    }

    @Test
    void testGetServiceById_Success() {
        when(repository.findById(1L)).thenReturn(Optional.of(item1));

        ServiceItemResponse result = catalogService.getServiceById(1L);

        assertNotNull(result);
        assertEquals("Haircut", result.name());
        verify(repository, times(1)).findById(1L);
    }

    @Test
    void testGetServiceById_NotFound() {
        when(repository.findById(3L)).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class, () -> catalogService.getServiceById(3L));
        verify(repository, times(1)).findById(3L);
    }

    @Test
    void testCreateService() {
        when(repository.save(any(ServiceItem.class))).thenAnswer(invocation -> {
            ServiceItem saved = invocation.getArgument(0);
            saved.setId(3L);
            return saved;
        });

        ServiceItemResponse result = catalogService.createService(request);

        assertNotNull(result);
        assertEquals(3L, result.id());
        assertEquals("New Haircut", result.name());
        assertEquals(BigDecimal.valueOf(35.0), result.price());
        assertEquals(45, result.durationMinutes());
        assertEquals("Hair", result.category());
        assertEquals("Premium haircut", result.description());
        verify(repository, times(1)).save(any(ServiceItem.class));
    }

    @Test
    void testUpdateService_Success() {
        when(repository.findById(1L)).thenReturn(Optional.of(item1));
        when(repository.save(any(ServiceItem.class))).thenReturn(item1);

        ServiceItemResponse result = catalogService.updateService(1L, request);

        assertNotNull(result);
        assertEquals(1L, result.id());
        assertEquals("New Haircut", result.name());
        assertEquals(BigDecimal.valueOf(35.0), result.price());
        verify(repository, times(1)).findById(1L);
        verify(repository, times(1)).save(item1);
    }

    @Test
    void testUpdateService_NotFound() {
        when(repository.findById(3L)).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class, () -> catalogService.updateService(3L, request));
        verify(repository, times(1)).findById(3L);
        verify(repository, never()).save(any(ServiceItem.class));
    }

    @Test
    void testDeleteService_Success() {
        when(repository.findById(1L)).thenReturn(Optional.of(item1));
        doNothing().when(repository).delete(item1);

        assertDoesNotThrow(() -> catalogService.deleteService(1L));

        verify(repository, times(1)).findById(1L);
        verify(repository, times(1)).delete(item1);
    }

    @Test
    void testDeleteService_NotFound() {
        when(repository.findById(3L)).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class, () -> catalogService.deleteService(3L));

        verify(repository, times(1)).findById(3L);
        verify(repository, never()).delete(any(ServiceItem.class));
    }
}
