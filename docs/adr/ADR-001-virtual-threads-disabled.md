# ADR-001: Virtual Threads Disabled

**Status:** Accepted

## Context

Spring Boot 3.5+ provides built-in support for Virtual Threads (Project Loom). Virtual threads promise lightweight concurrency by allowing applications to spawn thousands of threads without the overhead of traditional OS/platform threads. The TaskFlow application was evaluated for virtual thread usage during its initial architecture design.

The application is database-bound, making heavy use of HikariCP connection pooling, JPA repositories, and transactional service methods. Each request typically involves one or more database queries.

## Decision

Virtual threads are **disabled**. The application uses platform threads with a fixed thread pool instead.

The key concern is the interaction between virtual threads and connection pooling. With virtual threads enabled, every incoming request creates a new virtual thread. When that thread tries to acquire a connection from the HikariCP pool, it may be blocked if all connections are in use. However, the servlet container does not bound the number of virtual threads, so the application can accept an unbounded number of requests — all of which pile up waiting for a database connection. This leads to:

- Connection pool saturation under load
- Unbounded memory pressure from queued virtual threads
- Difficulty predicting application behavior under stress

Platform threads, combined with a bounded Tomcat thread pool (`server.tomcat.threads.max`), provide a natural backpressure mechanism: once the thread pool is full, the server stops accepting requests, giving the existing requests a chance to complete and release connections.

## Consequences

### Positive
- **Predictable thread behavior** — the fixed thread pool acts as a circuit breaker, preventing unbounded concurrency.
- **Easier debugging** — platform threads produce familiar thread dumps that can be analyzed with standard JVM tooling.
- **Compatibility** — all JVM and library features work without virtual-thread-specific bugs or limitations.

### Negative
- **Slightly higher per-thread memory overhead** — each platform thread has a larger stack (~1 MB) compared to virtual threads (negotiable small stacks).
- **Fewer concurrent requests** — the fixed thread pool limits how many requests can be handled simultaneously, whereas virtual threads could theoretically handle thousands more.
