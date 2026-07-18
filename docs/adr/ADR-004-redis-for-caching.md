# ADR-004: Redis for Caching (not Caffeine)

**Status:** Accepted

## Context

The application requires a caching layer to reduce database load and improve response times for frequently accessed data. Spring Boot provides the Spring Cache abstraction, which supports multiple backend implementations — including Caffeine (in-process local cache) and Redis (external distributed cache).

The application also requires Redis for rate limiting (bucket4j with Redis backend). This means Redis is already a dependency in the stack regardless of the caching decision.

## Decision

**Redis** was chosen as the cache backend over Caffeine, using the Spring Cache abstraction with `@Cacheable`, `@CacheEvict`, and `@CachePut` annotations.

The primary reasons:

1. **Redis is already required** — the application uses Redis-backed rate limiting. Adding Redis as a cache backend does not introduce a new infrastructure dependency; it only increases utilization of an existing one.

2. **Cache consistency across instances** — if the application scales to multiple backend instances (horizontal scaling), an in-process cache like Caffeine would become inconsistent: each instance would have its own copy of cached data, and an eviction on one instance would not propagate to others. Redis provides a single source of truth.

3. **Centralized cache management** — Redis provides CLI commands (`KEYS`, `SCAN`, `TTL`, `DEL`, `FLUSHDB`) and GUI tools (RedisInsight) to inspect, purge, or analyze the cache in production. Managing per-instance Caffeine caches would require access to each JVM's heap.

4. **Consistent TTL-based eviction** — Redis TTL expiration works identically in development (local Redis via docker-compose) and production. Caffeine's expiration policies, while similar, behave slightly differently and would require separate tuning.

5. **Simpler operational model** — one caching technology to learn, monitor, and tune. The team needs expertise in Redis, not in both Redis and Caffeine.

## Consequences

### Positive
- **Consistent caching behavior** across all deployment topologies (single instance, multi-instance, Kubernetes).
- **Single caching technology** to learn, maintain, and monitor.
- **Centralized observability** — cache hit/miss ratios, memory usage, and eviction rates are visible via Redis `INFO` and monitoring tools.
- **Cache persistence** — Redis can persist cached data across restarts (if configured), whereas Caffeine caches are entirely ephemeral.

### Negative
- **Network hop for cache lookups** — each cache lookup requires a round trip to the Redis server, adding latency compared to in-process Caffeine access (sub-microsecond vs ~1 ms).
- **Redis is another service to manage** — requires monitoring, backup, and capacity planning separate from the application.
- **Serialization overhead** — cached objects must be serialized to Redis (typically JSON or binary) and deserialized on read, adding CPU overhead that Caffeine (in-heap object references) avoids.
