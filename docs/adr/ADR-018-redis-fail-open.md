# ADR-018: Fail Open When Redis Is Slow or Down

**Status:** Accepted

## Context

Redis holds the Spring caches (catalog, barbers, busy slots, stats), the rate-limit buckets, the JWT denylist, the failed-login counters and the cross-replica cache-load lease. The security state already had per-JVM fallbacks (`RedisBackoff`, `FixedWindowCounter`, the local revocation map), but three gaps showed up when Redis was frozen (`SIGSTOP`) for 25 s under load (BENCHMARKS.md §58):

1. **No cache error handler.** Every `@Cacheable` read propagated the Redis error. The public catalog served **0%** of its traffic for the whole outage: 293 requests ended in 503 after 2–4 s each, although PostgreSQL was healthy.
2. **A 2 s command timeout** (`spring.data.redis.timeout=2000`). Each fallback was reached only after a full timeout.
3. **Thundering probes.** When a 5 s back-off interval ended, every in-flight request tried Redis at once and stalled for the full timeout. `/auth/me` (rate limiter + revocation check, no database) served 50% of its traffic with 12 near-zero seconds.

## Decision

1. **Treat a failing cache store as a cache miss.** `CacheErrorHandlingConfig` registers `FailOpenCacheErrorHandler`: a failed read runs the method, a failed write or eviction is skipped. It logs the first failure and at most one line per 30 s (one WARN per request would flood the blocking log queue). `AppointmentStatsService`, which calls the cache directly, bypasses the store the same way.
2. **Skip Redis reads while it is known to be failing.** `RedisBackoffCacheManager` sits beneath `SingleFlightCacheManager`: after a failed cache command, reads report a miss and loaders run directly for the back-off interval, and loaded values are not written. Evictions are always attempted, since skipping one could leave a stale entry once Redis is back. The cross-replica load lease shares the same back-off.
3. **One probe per interval.** `RedisBackoff.allowRequest()` lets exactly one caller try Redis when an interval ends; everyone else keeps the fallback until that probe succeeds or fails. `isAvailable()` stays a non-claiming peek. The rate limiter uses `RedisBackoff` instead of its inline copy.
4. **`spring.data.redis.timeout=250ms` in production.** The commands are sub-millisecond when Redis is healthy; the timeout only decides how long a request waits before its fallback.

## Consequences

### Positive
- With Redis frozen for 25 s: `/auth/me` kept its full throughput (worst case 325 ms, was 2 s); the catalog served ~38% of normal throughput with **0 errors** (was 0% served).
- With Redis killed (connection refused) and the 250 ms timeout, `/auth/me` served 90%.
- Redis failures are logged as Redis failures (`GlobalExceptionHandler.unavailableResource`), not as "Database resource unavailable".

### Negative
- **Stale entries after an outage:** a write or eviction skipped while Redis was down can leave an entry that lives until its TTL (at most 10 minutes for reference data, 2 minutes for busy slots). Bookings are re-validated in their own transaction, never from the cache.
- **Cached endpoints are slower during an outage:** loads of one key stay serialised per JVM by `SingleFlightCacheManager`, which is what keeps a Redis outage from turning into a database stampede; the catalog therefore stays at ~38% rather than 100%.
- **Per-JVM limits during an outage:** unchanged from before. With N replicas the rate and login limits become up to N × the configured value while Redis is unavailable.
- **A slow but healthy Redis** (commands over 250 ms) is now treated as failing. That is intended: such latency on every request is worse than the fallback.

## Verification

- `FailOpenCacheErrorHandlerTest` (a `@Cacheable(sync = true)` method keeps answering with a throwing cache), `RedisBackoffCacheManagerTest`, `RedisBackoffTest` (one probe per interval), `AppointmentStatsServiceTest` (store failure vs query failure).
- The real-Redis suites (`TASKFLOW_TEST_REDIS_URL`) and the outage measurements in BENCHMARKS.md §58.
