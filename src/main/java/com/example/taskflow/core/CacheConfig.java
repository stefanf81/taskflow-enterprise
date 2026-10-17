package com.example.taskflow.core;

import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.BasicPolymorphicTypeValidator;
import com.fasterxml.jackson.databind.jsontype.PolymorphicTypeValidator;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.RedisSerializer;
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
 * removal in a future Jackson 2.x release. The Jackson 3 successor is available
 * ({@code GenericJacksonJsonRedisSerializer}, Spring Data Redis 4), but a
 * switch changes the on-the-wire cache format: entries written by the Jackson 2
 * serializer would be deserialization errors until their TTL expires. Migration
 * is therefore deferred to a dedicated change; until then, the explicit
 * allow-list below keeps the deserialization surface secure — only the concrete
 * types we actually cache are permitted, eliminating the gadget-vector risk.
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
                    .allowIfSubType("com.example.taskflow.appointment.BarberResponse")
                    .allowIfSubType("com.example.taskflow.appointment.PublicBarberResponse")
                    .allowIfSubType("com.example.taskflow.catalog.ServiceItemResponse")
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
                    .allowIfSubType("java.math.BigDecimal")
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

    private static final RedisSerializer<Object> CACHE_VALUE_SERIALIZER =
            new GenericJackson2JsonRedisSerializer(redisObjectMapper());

    /**
     * The single value serializer shared by every cache (thread-safe). Package-private so
     * {@code CacheRedisSerializationTest} exercises the production serializer instead of a
     * duplicated copy that could drift from the allow-list.
     */
    static RedisSerializer<Object> cacheValueSerializer() {
        return CACHE_VALUE_SERIALIZER;
    }

    /**
     * BKG-7: wraps the Redis cache manager (only) in a {@link SingleFlightCacheManager}. Spring Data
     * Redis' default non-locking writer ignores {@code @Cacheable(sync = true)}, so without this a
     * cold or just-evicted key is loaded once per concurrent request. The decorator serialises loads
     * per (cache, key) inside this JVM, and with {@code app.state.store=redis} also across replicas
     * through a per-key Redis lease ({@link RedisCacheLoadLock}, taken on misses only; lease
     * {@code app.cache.single-flight.lock-lease-ms}, default 10 s; a caller that lost the lease waits
     * at most {@code app.cache.single-flight.max-wait-ms}, default 5 s, before loading itself). Any
     * Redis error on the lease falls back to the per-JVM behaviour. Beneath it,
     * {@link RedisBackoffCacheManager} keeps reads off Redis for a few seconds after a cache command
     * failed (loaders run directly); the lease shares that back-off, so a Redis outage costs one
     * command timeout per interval rather than one per request. The dev/test {@code simple}
     * manager already serialises and is left untouched.
     *
     * <p>Static so the post-processor is available early without instantiating this configuration;
     * the Redis template is looked up lazily on the first miss, never during startup.
     */
    @Bean
    public static BeanPostProcessor singleFlightCacheManagerPostProcessor(
            Environment environment, ObjectProvider<StringRedisTemplate> redisTemplate) {
        RedisBackoff backoff = new RedisBackoff("Redis cache");
        SingleFlightCacheManager.DistributedLoadLock lock = null;
        if (SharedStateStore.isRedis(environment)) {
            Duration lease = Duration.ofMillis(environment.getProperty("app.cache.single-flight.lock-lease-ms",
                    Long.class, RedisCacheLoadLock.DEFAULT_LEASE.toMillis()));
            lock = new RedisCacheLoadLock(redisTemplate::getObject, lease, backoff);
        }
        Duration maxWait = Duration.ofMillis(environment.getProperty("app.cache.single-flight.max-wait-ms",
                Long.class, SingleFlightCacheManager.DEFAULT_MAX_WAIT.toMillis()));
        return singleFlightPostProcessor(lock, maxWait, backoff);
    }

    static BeanPostProcessor singleFlightPostProcessor(SingleFlightCacheManager.DistributedLoadLock lock,
                                                       Duration maxWait) {
        return singleFlightPostProcessor(lock, maxWait, new RedisBackoff("Redis cache"));
    }

    static BeanPostProcessor singleFlightPostProcessor(SingleFlightCacheManager.DistributedLoadLock lock,
                                                       Duration maxWait, RedisBackoff backoff) {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                return bean instanceof RedisCacheManager redis
                        ? new SingleFlightCacheManager(new RedisBackoffCacheManager(redis, backoff), lock, maxWait)
                        : bean;
            }
        };
    }

    /** The admin dashboard's server-sent-event stream (see {@code AppointmentController}). */
    static final String EVENT_STREAM_PATH = "/api/v1/appointments/events";

    @Bean
    public Filter shallowEtagHeaderFilter() {
        return new ShallowEtagHeaderFilter() {
            @Override
            protected boolean isEligibleForEtag(HttpServletRequest request, HttpServletResponse response,
                                                int responseStatusCode, InputStream inputStream) {
                return "GET".equals(request.getMethod());
            }

            /**
             * The filter buffers the whole body to hash it, so it must never see a stream: wrapped,
             * the SSE response sent nothing (not even headers) until it ended 30 minutes later, and
             * every open stream kept its events in memory.
             */
            @Override
            protected boolean shouldNotFilter(HttpServletRequest request) {
                String accept = request.getHeader("Accept");
                return request.getRequestURI().endsWith(EVENT_STREAM_PATH)
                        || (accept != null && accept.contains("text/event-stream"));
            }
        };
    }

    @Bean
    public RedisCacheConfiguration cacheConfiguration() {
        return RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(10))
                .disableCachingNullValues()
                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(cacheValueSerializer()));
    }

    @Bean
    public RedisCacheManagerBuilderCustomizer redisCacheManagerBuilderCustomizer() {
        return builder -> builder
                .withCacheConfiguration("appointmentStats",
                        RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(5))
                                .disableCachingNullValues()
                                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(cacheValueSerializer())))
                .withCacheConfiguration("busySlots",
                        RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(2))
                                .disableCachingNullValues()
                                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(cacheValueSerializer())))
                .withCacheConfiguration("barbers",
                        RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(10))
                                .disableCachingNullValues()
                                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(cacheValueSerializer())))
                .withCacheConfiguration("publicBarbers",
                        RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(10))
                                .disableCachingNullValues()
                                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(cacheValueSerializer())))
                .withCacheConfiguration("services",
                        RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(10))
                                .disableCachingNullValues()
                                .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(cacheValueSerializer())));
    }
}
