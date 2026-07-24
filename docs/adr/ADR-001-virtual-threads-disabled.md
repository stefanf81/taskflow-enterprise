# ADR-001: Virtual Threads — Superseded

**Status:** Superseded by §32/§33 benchmark results. Virtual threads are now **enabled**.

## Context

Spring Boot 3.5+ provides built-in support for Virtual Threads (Project Loom). Virtual threads promise lightweight concurrency by allowing applications to spawn thousands of threads without the overhead of traditional OS/platform threads. The TaskFlow application was evaluated for virtual thread usage during its initial architecture design.

The application is database-bound, making heavy use of HikariCP connection pooling, JPA repositories, and transactional service methods. Each request typically involves one or more database queries.

## Original Decision (Now Superseded)

Virtual threads were originally **disabled**. The application used platform threads with a fixed thread pool instead.

The key concern was the interaction between virtual threads and connection pooling. With virtual threads enabled, every incoming request creates a new virtual thread. When that thread tries to acquire a connection from the HikariCP pool, it may be blocked if all connections are in use. However, the servlet container does not bound the number of virtual threads, so the application can accept an unbounded number of requests — all of which pile up waiting for a database connection. This leads to:

- Connection pool saturation under load
- Unbounded memory pressure from queued virtual threads
- Difficulty predicting application behavior under stress

Platform threads, combined with a bounded Tomcat thread pool (`server.tomcat.threads.max`), provide a natural backpressure mechanism: once the thread pool is full, the server stops accepting requests, giving the existing requests a chance to complete and release connections.

## Why This Was Superseded

Benchmark §32 (Virtual Threads vs Platform Threads, I/O-Bound Mixed Workload) and §33 (HikariCP Pool Size Sweep Under Virtual Threads) demonstrated that:

1. **Virtual threads are enabled by default in Spring Boot 4.1.0** — `spring.threads.virtual.enabled=true` is the framework default.
2. **Throughput scales linearly with HikariCP pool size under VT** — pool=50 delivers 5,648 req/s vs PT baseline of 1,908 req/s (2.96× improvement).
3. **The original connection pool saturation concern is mitigated** by increasing `maximum-pool-size` from 10 to 25 for production PostgreSQL.
4. **The CPU-bound `/login` (BCrypt) regression is absorbed** by the read-heavy workload mix in production (70% reads, 30% writes).
