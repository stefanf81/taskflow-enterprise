package com.example.taskflow.catalog;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Boots the catalog module on its own (plus the shared {@code core} module). */
@ApplicationModuleTest
@TestPropertySource(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class CatalogModuleTest {

    @Autowired
    private CatalogService catalogService;

    @Test
    void createsAndListsAServiceWithoutAnyOtherModule() {
        String name = "Module Test Cut " + UUID.randomUUID();

        ServiceItemResponse created = catalogService.createService(
                new ServiceItemRequest(name, new BigDecimal("19.50"), 30, "hair", "created by CatalogModuleTest"));
        try {
            assertTrue(catalogService.getAllServices().stream().anyMatch(s -> name.equals(s.name())));
            assertEquals(30, catalogService.getServiceById(created.id()).durationMinutes());
        } finally {
            catalogService.deleteService(created.id());
        }
    }

    @Test
    void findsAServiceByItsName() {
        String name = "Module Lookup Cut " + UUID.randomUUID();
        ServiceItemResponse created = catalogService.createService(
                new ServiceItemRequest(name, new BigDecimal("12.00"), 45, "hair", null));
        try {
            ServiceItem found = catalogService.findServiceByName(name).orElseThrow();

            assertEquals(name, found.getName());
            assertEquals(45, found.getDurationMinutes());
        } finally {
            catalogService.deleteService(created.id());
        }
    }
}
