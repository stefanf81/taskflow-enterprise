# ADR-012: Lua-Atomic Rate Limiter

**Status:** Accepted

## Context

`RateLimiterConfig` enforces per-IP fixed-window rate limits on `/*` before Spring Security reaches JWT verification and BCrypt (`Ordered.HIGHEST_PRECEDENCE + 20`). Two limits are applied: `app.rate-limit.max-requests-per-minute` (default 100, general API) and `app.rate-limit.auth-max-requests-per-minute` (default 20, `POST /api/v1/auth/**`). The filter skips `/actuator/health/**` so Kubernetes liveness/readiness probes do not burn budget.

The original implementation used two separate Redis commands:

```
INCR rate_limit:{ip}:{api|auth}
EXPIRE rate_limit:{ip}:{api|auth} 60000
```

This has a correctness race: if the process crashes between `INCR` and `EXPIRE`, the key is left without a TTL (`TTL -1`) and the IP's bucket is **permanently blocked** until manual `DEL` or Redis restart. It also costs 2 RTTs per request (~976 µs measured on local Docker Redis).

Redis is already provisioned for caching (ADR-004 / ADR-011), so the fix must be Redis-native and preserve the fixed-window semantics.

## Decision

Replace the two-step sequence with a single **Lua `EVAL`** executed atomically on Redis's single-threaded engine via `StringRedisTemplate.execute(DefaultRedisScript<Long>)` (`src/main/java/com/example/taskflow/core/RateLimiterConfig.java:38`):

```lua
local c = redis.call('incr', KEYS[1]);
if c == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end;
return c
```

* `KEYS[1] = rate_limit:{clientIp}:{auth|api}` (IP from `request.getRemoteAddr()` after `ForwardedHeaderFilter` normalizes `X-Forwarded-For` from the trusted Nginx proxy; `server.forward-headers-strategy=framework` in prod, `APP_TRUSTED_PROXY_REGEX` restricts trusted proxies).
* `ARGV[1] = 60000` (1-minute window in milliseconds, `PEXPIRE`).
* `PEXPIRE` is set **only when `c == 1`** (first increment in the window) — the window is **fixed**, not sliding; subsequent `INCR` within the window do not extend TTL (verified: extra `INCR` after 120 ms sleep left TTL decreasing).
* On overflow (`count > maxRequests`) the filter returns `429 Too Many Requests` with `Retry-After: 60` and JSON `{"error":"Too many requests. Please try again later."}` without calling `filterChain`. On Redis error the filter **fails open** (`log.warn … failed open`) and continues the chain — availability over strict limiting during Redis outage.

Conditional on `app.rate-limit.enabled` (`@ConditionalOnProperty`, disabled by default; `application-prod.properties` enables it — requires Redis).

## Consequences

### Positive
- **Atomicity fix (P0):** Eliminates the TTL-leak race — TTL is always set atomically with the first `INCR`. Verified: two-step path without `EXPIRE` left `TTL -1`; Lua path always `0 < ttl ≤ 60000 ms`.
- **1.6× faster:** One RTT instead of two — **623 µs vs 976 µs** per request (353 µs saved, local Docker RTT ~0.2–0.5 ms). Burst throughput **39,476 ops/sec** on a single key (50 threads × 20 `INCR` = 1000 ops, final count 1000/1000, no lost increments — Redis single-threaded `EVAL` atomic, BENCHMARKS.md §40).
- **Production pattern:** This is the `jhipster` / `spring-boot-best-practice` recommended shape; no `WATCH`/`MULTI` needed.

### Negative
- **Lua script management:** The script is stored as a Java string literal in `RateLimiterConfig.java`; any change requires a code deploy (no external script file). The `DefaultRedisScript<Long>` result type must match Redis `integer-reply`.
- **Fixed-window burst edge:** Fixed-window limits can allow `2×` burst at window boundaries (e.g., `maxRequests` at `T=59s` + `maxRequests` at `T=61s`). Sliding-window or token-bucket would be smoother but more complex; the fixed window is sufficient for abuse protection at this scale.
- **No rate-limit headers:** `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` are not set on successful requests (see AUDIT-REPORT.md L16). Clients see only `429` + `Retry-After` on excess.

## Verification

Benchmark: `src/test/java/com/example/taskflow/benchmark/RateLimiterBenchmarkTest.java` (Redis `8.10.1-alpine` at `localhost:6379`, H2 profile, `@Tag("benchmark")`) compares two-step vs Lua path and asserts TTL and burst atomicity. `P1AndP2BenchmarkTest` checks `RateLimiterConfig.java` for `EVAL` Lua shape and `HIGHEST_PRECEDENCE+20`.
