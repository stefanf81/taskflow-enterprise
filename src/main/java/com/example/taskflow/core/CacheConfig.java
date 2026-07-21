package com.example.taskflow.core;

import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.BasicPolymorphicTypeValidator;
import com.fasterxml.jackson.databind.jsontype.PolymorphicTypeValidator;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import org.springframework.web.filter.ShallowEtagHeaderFilter;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.InputStream;
import java.time.Duration;

@Configuration
@SuppressWarnings({"deprecation", "removal"})
public class CacheConfig {

    /**
     * P4: Explicit allow-list for Jackson default typing instead of the unsafe
     * LaissezFaireSubTypeValidator. Only the concrete types we actually cache are
     * permitted to be reconstructed from Redis, eliminating the polymorphic
     * deserialization (gadget-vector) attack surface.
     *
     * We use allowIfSubType (not allowIfBaseType) because GenericJackson2JsonRedisSerializer
     * always uses {@code Object} as the declared base type, so the base-type check would never
     * match. The concrete runtime type is what gets stored in the {@code @class} JSON property
     * and what the validator needs to approve.
     *
     * The allowed types cover:
     * - AppointmentStats: our domain stats record (uses @JsonTypeInfo annotation)
     * - java.util.ArrayList: returned by JPA repository queries
     * - java.util.Arrays$ArrayList: returned by Arrays.asList()
     * - java.util.Collections$EmptyList: returned by Collections.emptyList()
     * - java.util.Collections$SingletonList: returned by Collections.singletonList()
     * - java.util.ImmutableCollections.*: returned by List.of() in Java 21+
     *
     * These are all JDK standard-library types with no known deserialization gadgets,
     * making this configuration secure.
     */
    private static final PolymorphicTypeValidator CACHE_TYPE_VALIDATOR =
            BasicPolymorphicTypeValidator.builder()
                    .allowIfSubType("com.example.taskflow.appointment.AppointmentStats")
                    .allowIfSubType("java.util.ArrayList")
                    .allowIfSubType("java.util.Arrays$ArrayList")
                    .allowIfSubType("java.util.Collections$EmptyList")
                    .allowIfSubType("java.util.Collections$SingletonList")
                    .allowIfSubType("java.util.ImmutableCollections")
                    .build();

    private static ObjectMapper redisObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.activateDefaultTyping(
                CACHE_TYPE_VALIDATOR,
                ObjectMapper.DefaultTyping.NON_FINAL,
                JsonTypeInfo.As.PROPERTY
        );
        return mapper;
    }

    @Bean
    public Filter shallowEtagHeaderFilter() {
        return new ShallowEtagHeaderFilter() {
            @Override
            protected boolean isEligibleForEtag(HttpServletRequest request, HttpServletResponse response,
                                                int responseStatusCode, InputStream inputStream) {
                return "GET".equals(request.getMethod());
            }
        };
    }

    @Bean
    public RedisCacheConfiguration cacheConfiguration() {
        return RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(10))
                .disableCachingNullValues()
                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer(redisObjectMapper())));
    }

    @Bean
    public RedisCacheManagerBuilderCustomizer redisCacheManagerBuilderCustomizer() {
        return builder -> builder
                .withCacheConfiguration("appointmentStats",
                        RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(5))
                                .disableCachingNullValues()
                                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer(redisObjectMapper()))))
                .withCacheConfiguration("busySlots",
                        RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(2))
                                .disableCachingNullValues()
                                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer(redisObjectMapper()))));
    }
}
