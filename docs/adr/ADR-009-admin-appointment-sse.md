# ADR-009: Admin Appointment Updates via Server-Sent Events

## Status

Accepted

## Context

The Angular admin dashboard previously refreshed appointment data only after local
actions or manual reloads. A second administrator or a guest booking could change
the database without immediately updating an already-open dashboard.

TaskFlow needs server-to-browser notifications, not bidirectional messaging. The
web client already authenticates with an HttpOnly cookie, and the dashboard already
has an authoritative paginated REST query backed by `AppointmentStore`.

## Decision

Use an admin-only Server-Sent Events endpoint:

```text
GET /api/v1/appointments/events
```

The endpoint is protected by `ROLE_ADMIN` and uses the existing HttpOnly
`access_token` cookie. The browser uses the native `EventSource` API with
`withCredentials: true`; JWTs are never exposed to JavaScript or placed in URLs.

The stream sends small, immutable, PII-free signals:

```text
appointment.created
appointment.updated
appointment.deleted
```

Each event contains the event type, appointment ID, and timestamp. The REST
`GET /api/v1/appointments` response remains the source of truth. The Angular
client responds to an event by reloading the current `AppointmentStore` query,
preserving its page, filter, and search state.

Appointment mutations publish the signal inside their transaction, but the SSE
listener uses `@TransactionalEventListener(AFTER_COMMIT)`. A rolled-back mutation
therefore cannot notify connected dashboards.

The initial implementation keeps emitters in memory, limits connections per admin,
sends heartbeats, and removes emitters on completion, timeout, or write failure.
Nginx disables buffering and uses a long upstream read timeout for this endpoint.

## Consequences

### Positive

- No new frontend dependency is required.
- Existing REST query and authorization rules remain authoritative.
- Appointment PII is not broadcast through the event payload.
- Cookies avoid token leakage through query strings.
- SSE is simpler than WebSockets for one-way server updates.
- Existing local Docker deployment supports the implementation.

### Limitations

- The emitter registry is local to one backend instance.
- Events are best-effort UI refresh signals and are not replayable.
- A disconnect can cause a missed event; the next dashboard load restores state.
- Production deployments with multiple backend replicas require shared fanout,
  such as Redis Pub/Sub, and should eventually add durable event IDs/replay.
- Deployments intentionally close streams during the existing graceful shutdown
  window; the browser reconnects and reloads the REST snapshot.

## Operational Configuration

The defaults are defined in `src/main/resources/application.properties`:

```properties
app.sse.max-connections-per-admin=2
app.sse.heartbeat-interval-ms=20000
```

The Nginx location in `frontend/nginx.conf` must retain:

- `proxy_buffering off`
- `proxy_cache off`
- `proxy_read_timeout 1h`
- `gzip off` and `brotli off`

## Verification

SSE behavior is covered by backend and frontend unit tests. Full-stack verification
must also exercise the stream through Nginx, not only directly against port 8080.

```bash
./verify.sh
```
