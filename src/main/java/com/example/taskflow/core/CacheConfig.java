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

/**
 * Redis-backed cache configuration with an explicit polymorphic-type allow-list.
 *
 * <p><b>Dependency note:</b> {@code activateDefaultTyping} and
 * {@code BasicPolymorphicTypeValidator} are marked {@code @Deprecated} / for
 * removal in a future Jackson 2.x release (the recommended successor is
 * Jackson 3's {@code DefaultTyping} API). This project already pins Jackson 3
 * (see build.gradle) and will migrate to the new API once
 * {@code GenericJackson2JsonRedisSerializer} (Spring Data Redis) exposes a
 * Jackson 3-compatible constructor. Until then, the explicit allow-list below
 * keeps the deserialization surface secure — only the concrete types we
 * actually cache are permitted, eliminating the gadget-vector risk.
 */
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
     * DefaultTyping is set to EVERYTHING (not NON_FINAL) because JDK 21+
     * {@code List.of()} returns {@code ImmutableCollections$ListN} — a
     * <b>final</b> inner class. NON_FINAL skips final types, so no {@code @class}
     * is written and Jackson cannot resolve the type on deserialization (it
     * falls into a code path that misinterprets the first array element as a
     * type ID, surfacing an InvalidTypeIdException).
     *
     * The allowed types cover every concrete type that appears in a cached
     * value.  All are JDK standard-library types or our own domain record with
     * no known deserialization gadgets, keeping this configuration secure.
     */
    private static final PolymorphicTypeValidator CACHE_TYPE_VALIDATOR =
            BasicPolymorphicTypeValidator.builder()
                    .allowIfSubType("com.example.taskflow.appointment.AppointmentStats")
                    .allowIfSubType("java.util.ArrayList")
                    // List types from JDK 21+ List.of() and other collection
                    // factories. ImmutableCollections inner classes are
                    // package-private so Class.isAssignableFrom may fail;
                    // enumerating them explicitly guarantees matching.
                    .allowIfSubType("java.util.ImmutableCollections$ListN")
                    .allowIfSubType("java.util.ImmutableCollections$List12")
                    .allowIfSubType("java.util.Collections$EmptyList")
                    .allowIfSubType("java.util.Collections$SingletonList")
                    .allowIfSubType("java.util.Arrays$ArrayList")
                    // Value types that appear as elements of cached collections
                    .allowIfSubType("java.lang.String")
                    .allowIfSubType("java.lang.Long")
                    .allowIfSubType("java.lang.Double")
                    .allowIfSubType("java.lang.Integer")
                    .build();

    private static ObjectMapper redisObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        // EVERYTHING (not NON_FINAL): JDK 21+ List.of() returns final inner
        // classes that NON_FINAL skips, leaving bare JSON arrays in Redis
        // that Jackson cannot deserialize. EVERYTHING ensures @class is
        // always written; the explicit allow-list (PolymorphicTypeValidator)
        // still gates what types can be reconstructed.
        mapper.activateDefaultTyping(
                CACHE_TYPE_VALIDATOR,
                ObjectMapper.DefaultTyping.EVERYTHING,
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
