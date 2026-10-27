# Gotchas and testing notes

Things that bite: which Gradle task needs Docker, guard tests, cache/header alignment and the offline-startup rule.

_Detail moved out of [`AGENTS.md`](../../AGENTS.md); the text is unchanged._

- **Testcontainers** are used for PostgreSQL integration tests. The tagged
  `testcontainersTest` task requires Docker; the default `test` task excludes
  those tests and runs against H2 without Docker.
- **ArchUnit** enforces package-level architecture constraints (`src/test/java/com/example/taskflow/architecture/`).
## Gotchas

- `./gradlew test` runs the Docker-independent H2 test suite. Use
  `./gradlew testcontainersTest` for the tagged PostgreSQL/Testcontainers suite;
  that task requires Docker.
- Full `./verify.sh` also requires `psql` on `PATH` for the migration-preparation script tests. Homebrew's `libpq` is keg-only: use `PATH="$(brew --prefix libpq)/bin:$PATH" ./verify.sh` after installing it.
- On macOS Rancher Desktop (`unix://…/.rd/docker.sock`), `verify.sh` sets `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` for Ryuk unless already explicitly set. Direct Gradle invocations need that environment override too; do not disable Ryuk or change the host Docker endpoint to fix the VM mount.
- `./gradlew check` does not run OWASP dependency checking. Run `./gradlew dependencyCheckAnalyze` explicitly when needed (fails on CVSS >= 7).
- Container-config guards (`@Tag("container-config")`: `ContainerImageBenchmarkTest`, `GlibcTuningBenchmarkTest`, `ContainerConfigGuardTest`) are excluded from `test` and run in `containerConfigTest`, which declares the files they read as inputs. A new guard that reads another file must add it to that task's `inputs.files` (and, if it is a workflow, to CI's `docker_backend` filter).
- The `.env` file (from `.env.example`) is required by docker-compose and is git-ignored — copy `.env.example` to `.env` and adjust as needed. Change default passwords before production use.
- Frontend `dist/` and `node_modules/` are gitignored. Do not commit build artifacts.
- E2E tests (`npm run e2e`) start their own dev server — don't run `npm start` separately when running e2e.
- **PgBouncer ceiling**: The current deployment is one replica against PostgreSQL `max_connections=50`. Security and cache state is replica-safe (`app.state.store=redis`), but do not add replicas until admin SSE appointment events are distributed and PgBouncer transaction pooling (or pool × replicas < 50) is in place.
- **Cache eviction is verified, not assumed**: `barbers`/`publicBarbers`/`services` (`10 m`) & `busySlots` (`2 m`) use `@CacheEvict(allEntries=true)` on `create/update/delete`; `ReferenceDataCacheBenchmarkTest` asserts `200→201` after mutation. Don't add L2/Hib query cache without re-testing.
- **Cache-Control ↔ @Cacheable alignment**: Changing tiered headers (`5 m public` catalog/barbers/ratings, `30 s private` busySlots, `no-cache private` admin) must keep `10 m` `@Cacheable` and `ShallowEtagHeaderFilter` (GET-only) in sync — otherwise `304`/`TTL` mismatches cause stale or over-fetch.
- **HEALTHCHECK divergence**: Don't add `HEALTHCHECK` to the Dockerfile's `prod` target or to a stage it inherits from (`runtime`, `java-base`) — K8s `livenessProbe` owns prod; the `local` target keeps it for `docker run` & `depends_on: service_healthy` (`ContainerConfigGuardTest` asserts presence/absence).
- **Mobile query tuning**: `staleTime 0→60_000` cuts refetch ~50% — but raising further risks showing stale `DENIED` slots; `busySlots` stays `30 s private` for volatility. `timeout 10000` comfortably exceeds the ~9 s server-side worst case (JPA 5 s + Hikari `connection-timeout` 4 s) — don't lower it below that combined ceiling.
- **UseContainerSupport is explicit**: `JAVA_TOOL_OPTIONS` carries `UseContainerSupport` + `HeapDumpOnOutOfMemoryError` + `gc.log` in both `docker-compose.yml` and `homelab/TF` — sizing lives in env, not image CMD (last-wins precedence bug).
- **Default-profile startup must stay offline**: the AOT cache training run boots the real app under `--network=none`, so a startup-time call to an external service (or a bean that needs PostgreSQL/Redis to refresh) fails the image build. The `prod` target has no `curl`/`wget` — K8s probes must be `httpGet`, and debugging uses `kubectl debug`.
