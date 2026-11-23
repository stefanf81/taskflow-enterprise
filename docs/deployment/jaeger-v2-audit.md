# Jaeger v2 production audit (2026-11-23)

Jaeger 1.x reached end-of-life on 2025-12-31 ([jaeger#6321](https://github.com/jaegertracing/jaeger/issues/6321)).
This audit checks the production manifests in the GitOps repository against the ten-point checklist
from the 2026 stack review (`reports/TaskFlow stack gap best practices.md`, §8).

**Scope:** `stefanf81/homelab-TF` at `a48f3fe` (2026-11-23), `gitops/apps/taskflow/`, plus this repo's
`application-prod.properties`. The audit is read-only: the fix below has to be applied in the GitOps
repository.

**Verdict:** production already runs Jaeger v2, and nothing reachable from outside the node is exposed.
One finding: the pod runs the image's **built-in all-in-one configuration**, which still opens the legacy
v1 receivers and other unused listeners on every interface. Network policy blocks them today; trimming
the configuration removes them.

## Results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | v2 image pinned by digest; no v1 images | **Pass** | `jaeger.yaml`: `jaegertracing/jaeger:2.23.0@sha256:3823829974cc…` (the same digest as `docker-compose.yml`). No `all-in-one`, `jaeger-agent`, `-collector` or `-query` image anywhere under `gitops/`. |
| 2 | No v1 ports, no agent sidecar or DaemonSet | **Partial** | No v1 port is declared on the container or either Service, and there is no agent. But no config file is mounted, so the built-in config listens with `JAEGER_LISTEN_HOST=0.0.0.0` on 14250, 14268, 6831/udp, 6832/udp (Jaeger v1 receivers), 9411 (Zipkin), 4317 (OTLP gRPC, unused), 5778/5779 (remote sampling), 27777 (expvar), 27778 (zpages) and 8888 (metrics). `default-deny-datastore-ingress` plus `restrict-jaeger-access` admit only the backend on 4317/4318, so no other pod reaches them; anything on the node can. See the fix below. |
| 3 | Backend exports to 4318 `/v1/traces` | **Pass** | `application-prod.properties`: `management.opentelemetry.tracing.export.otlp.endpoint=http://jaeger:4318/v1/traces`; the `jaeger` Service maps 4318; backend egress is unrestricted (`namespace-default-deny.yaml`, SEC-04 note). |
| 4 | Storage not `memory`, or capped | **Pass (capped)** | `memory` with `max_traces=5000`, `GOMEMLIMIT=200MiB`, limit 256Mi (14-day peak 63Mi). Traces are lost on restart, which is acceptable for a diagnostics-only store. |
| 5 | Retention configured | **Pass (implicit)** | The 5,000-trace ring buffer is the retention. There is no time-based TTL; add one only if traces move to persistent storage. |
| 6 | Sampling below 100% | **Pass** | `management.tracing.sampling.probability=0.1` in `application-prod.properties`; no override in `backend.yaml` or `configmap.yaml`. The built-in `default_sampling_probability: 1` is not used: the SDK samples by probability, not through `jaeger_remote`. |
| 7 | UI, MCP, zpages and expvar not exposed without auth | **Pass** | No HTTPRoute for the UI (`httproute.yaml`, lines 39–44); `jaeger-ui` is ClusterIP and network policy denies every pod; access is `kubectl port-forward` only. MCP (`/api/ai/mcp/` on 16686) is enabled by the built-in config and is reachable the same way. |
| 8 | Probes on `healthcheckv2` :13133 | **Pass** | Startup, liveness and readiness probes all use `GET /status` on port 13133. |
| 9 | Renovate tracks tag and digest | **Pass** | `.github/renovate.json` enables the `kubernetes` manager for `gitops/apps/**`; Jaeger is not in the disabled list, and digest/patch updates automerge after CI. |
| 10 | Operator or Helm chart is v2-capable | **N/A** | Plain manifests, no operator or chart. |

## Recommended fix (GitOps repository)

Mount a trimmed configuration, as the compose stack already does with `jaeger/jaeger-config.yaml`, so
the pod listens only on what is used: OTLP HTTP, the UI, and health.

1. Add a ConfigMap, for example `jaeger-config.yaml` in `gitops/apps/taskflow/` (and list it in
   `kustomization.yaml`):

   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: jaeger-config
     namespace: taskflow
   data:
     config.yaml: |
       service:
         extensions: [jaeger_storage, jaeger_query, healthcheckv2]
         pipelines:
           traces:
             receivers: [otlp]
             processors: [batch]
             exporters: [jaeger_storage_exporter]
         telemetry:
           metrics:
             level: none
       extensions:
         jaeger_query:
           storage:
             traces: some_storage
           http:
             endpoint: "0.0.0.0:16686"
           # The query gRPC API defaults to :16685 on every interface; nothing uses it.
           grpc:
             endpoint: "localhost:16685"
         jaeger_storage:
           backends:
             some_storage:
               memory:
                 max_traces: 5000
         healthcheckv2:
           use_v2: true
           http:
             endpoint: "0.0.0.0:13133"
       receivers:
         otlp:
           protocols:
             http:
               endpoint: "0.0.0.0:4318"
       processors:
         batch:
       exporters:
         jaeger_storage_exporter:
           trace_storage: some_storage
   ```

   This drops the MCP endpoint. Keep `ai: { mcp: {} }` under `jaeger_query` only if someone uses it over
   `port-forward`.

2. In `jaeger.yaml`: mount the ConfigMap read-only (for example at `/etc/jaeger/config.yaml`), replace the
   `--set=…max_traces=5000` argument with `--config=/etc/jaeger/config.yaml`, and remove the
   `JAEGER_LISTEN_HOST` variable, which the trimmed file no longer reads.
3. Remove port 4317 from the container ports, the `jaeger` Service and `restrict-jaeger-access`: the
   backend exports over HTTP only.
4. After Flux applies it, confirm traces still arrive: open the UI through
   `kubectl port-forward -n taskflow svc/jaeger-ui 16686:16686` and look for recent `taskflow-backend`
   traces. One user reported OTLP HTTP export failures after a v2 upgrade (jaeger#6321), so check the
   exporter after every image bump too.

Validate the file before committing with the image itself:
`docker run --rm -v "$PWD/config.yaml:/c.yaml:ro" jaegertracing/jaeger:2.23.0 validate --config=/c.yaml`.

**Tested on 2026-11-23** with the pinned 2.23.0 digest: the configuration above passes `validate`, starts
("Everything is ready"), listens only on 4318, 16686 and 13133 on all interfaces (16685 on loopback),
answers `GET /status` on 13133, accepts an OTLP/HTTP span on `/v1/traces`, and lists its service through
the query API (`GET :16686/api/v3/services`).
