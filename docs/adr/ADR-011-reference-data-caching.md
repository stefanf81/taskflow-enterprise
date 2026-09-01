# ADR-011: Reference Data Caching (Barbers & Services)

**Status:** Accepted

## Context

The barber directory (`GET /api/v1/barbers`, `GET /api/v1/barbers/admin` façade `publicBarbers`) and service catalog (`GET /api/v1/catalog`) are read-mostly reference data: they change only on admin `create/update/delete` and are read on every guest and admin page load. Without caching, every request executed `findAllProjectedBy` against PostgreSQL (prod) or H2 (test), wasting Hikari connections and serialization cycles.

Earlier evaluations (BENCHMARKS.md §31) compared **Hibernate L2 query cache**, **Spring `@Cacheable`**, and **no cache**:

| Strategy | Avg (200 rows) | Overhead |
| :--- | ---: | :--- |
| No cache | 46 µs | Baseline |
| Hibernate L2 query cache | 110 µs | *Slower* than no cache (entity hydration + query-cache invalidation) |
| **Spring `@Cacheable` (DTO list)** | **0.037 µs (37 ns)** | **~1 200× faster** |

Hibernate L2 was slower because it still hydrates entities and re-evaluates constructors; the hot path serves DTO projections (`BarberResponse`, `PublicBarberResponse`, `ServiceItemResponse`), not managed entities.

Redis is already required for rate limiting, so using it for caching adds no new infrastructure (see ADR-004: Redis for Caching).

## Decision

Cache reference data at the **application DTO layer** with Spring Cache:

* **Caches:** `barbers`, `publicBarbers`, `services` — each `RedisCacheConfiguration` `entryTtl(Duration.ofMinutes(10))` (TTL **10m**). A fourth cache `busySlots` is separate (`TTL 2m`, see ADR-013).
* **Stampede protection:** `@Cacheable(value="barbers" / "publicBarbers" / "services", sync=true)` — per-key `synchronized` (one loader computes, others block) instead of 50 concurrent DB hits on cold start after deploy or eviction.
* **Eviction:** `@CacheEvict(value={"barbers","publicBarbers"}, allEntries=true)` on `BarberServiceImpl.createBarber` / `updateBarber` / `deleteBarber`; `@CacheEvict(value="services", allEntries=true)` on `CatalogServiceImpl.create/update/deleteService`.
* **Serialization:** `CacheConfig.java` `GenericJackson2JsonRedisSerializer` with an explicit `BasicPolymorphicTypeValidator` allow-list (`AppointmentStats`, `BarberResponse`, `PublicBarberResponse`, `ServiceItemResponse`, `java.util.ArrayList`, JDK `ImmutableCollections$ListN`/`List12`, `Collections$EmptyList`/`SingletonList`, `Arrays$ArrayList`, `String`/`Long`/`Double`/`Integer`/`BigDecimal`), `disableCachingNullValues()`, `DefaultTyping.EVERYTHING` (JDK 21+ `List.of()` returns final `ImmutableCollections$ListN` that `NON_FINAL` would skip). Until Spring Data Redis exposes a Jackson 3 API, the deprecated `activateDefaultTyping` path is retained with the allow-list gating deserialization (no `LaissezFaireSubTypeValidator` gadget risk).
* **Profiles:** Production `spring.cache.type=redis` (shared across replicas); dev `spring.cache.type=simple` (`ConcurrentHashMap`) exercises the same `@Cacheable` / `CacheManager` proxy without requiring Redis.

Controllers add a complementary HTTP tier (see ADR for Finding 31 / BENCHMARKS.md §44): `CacheControl.maxAge(5, MINUTES).cachePublic()` for the same endpoints, aligning 5m CDN/browser TTL with the 10m server TTL.

## Consequences

### Positive
- **Nanosecond hit path:** Cached hit is a single `ConcurrentHashMap.get()` (Redis `GET` in prod) over the already-mapped DTO list — zero Hibernate `EntityManager` open/close and zero constructor re-evaluation. Benchmark `ReferenceDataCacheBenchmarkTest` (BENCHMARKS.md §39, 200 rows, H2): **0.6 µs cached vs 42 µs DB** — **50–90×** on H2 and **~1 200×** on PostgreSQL over network.
- **Stampede-safe cold start:** `sync=true` prevents 50 concurrent misses from stampeding the DB.
- **Verified eviction:** Tests prime the cache, mutate (`createBarber` evicts both `barbers` + `publicBarbers`; `create/update/deleteService` evicts `services`), and assert `200 → 201` rows on the next read. `busySlots` 2m TTL remains independent (volatile data).
- **Shared across replicas:** Redis (prod) provides a single source of truth; no per-instance drift as with Caffeine.

### Negative
- **10m staleness window:** Between mutation and eviction there is a brief staleness window; eager `@CacheEvict` minimizes it, but a failed eviction (e.g., Redis down) would serve stale data until TTL expiry. Monitoring `CacheManager` errors and Redis `INFO` is required.
- **Serialization cost on write:** First miss serializes the DTO list to Redis JSON; subsequent hits deserialize. The allow-list must be updated when new cached types are introduced (see `CacheConfig.java:61` `CACHE_TYPE_VALIDATOR`).
- **Not a replacement for entity identity:** Hibernate L2 remains useful only for cross-request entity-by-ID loads outside the DTO-projection hot path — it is not enabled for these list endpoints.

## Verification

`ReferenceDataCacheBenchmarkTest` (`@Tag("benchmark")`, 200 barbers × 200 services, H2) asserts per-cache TTL, `sync=true` presence, and eviction semantics. `P1AndP2BenchmarkTest` checks `CacheConfig.java` for `RedisCacheConfiguration` 10m TTL and `@CacheEvict(allEntries=true)` on mutations.
