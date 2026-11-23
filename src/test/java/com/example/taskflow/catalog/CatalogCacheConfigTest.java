package com.example.taskflow.catalog;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.cache.RedisCacheWriter;

import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;

class CatalogCacheConfigTest {

    @Test
    void registersTheTypedServicesCache() {
        RedisCacheManager.RedisCacheManagerBuilder builder = RedisCacheManager.builder(mock(RedisCacheWriter.class));
        new CatalogCacheConfig().catalogCaches().customize(builder);

        assertEquals(Set.of("services", "products"), builder.getConfiguredCaches());
        RedisCacheConfiguration services = builder.getCacheConfigurationFor("services").orElseThrow();
        assertEquals(Duration.ofMinutes(10), services.getTtlFunction().getTimeToLive("key", "value"));
        assertFalse(services.getAllowCacheNullValues());

        List<ServiceItemResponse> catalog = List.of(
                new ServiceItemResponse(1L, "Cut", new BigDecimal("25.00"), 30, "hair", "desc"));
        ByteBuffer stored = services.getValueSerializationPair().write(catalog);
        assertEquals(catalog, services.getValueSerializationPair().read(stored));
    }

    @Test
    void registersTheTypedProductsCache() {
        RedisCacheManager.RedisCacheManagerBuilder builder = RedisCacheManager.builder(mock(RedisCacheWriter.class));
        new CatalogCacheConfig().catalogCaches().customize(builder);

        RedisCacheConfiguration products = builder.getCacheConfigurationFor("products").orElseThrow();
        assertEquals(Duration.ofMinutes(10), products.getTtlFunction().getTimeToLive("key", "value"));
        assertFalse(products.getAllowCacheNullValues());

        List<RetailProductResponse> list = List.of(
                new RetailProductResponse(1L, "Clay", "100ml", new BigDecimal("24.00"), 1),
                new RetailProductResponse(2L, "Balm", null, new BigDecimal("19.00"), 2));
        ByteBuffer stored = products.getValueSerializationPair().write(list);
        assertEquals(list, products.getValueSerializationPair().read(stored));
    }
}
