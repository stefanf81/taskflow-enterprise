# ADR-008: Reviewed OpenAPI Contract Baseline

## Status

Accepted

## Context

The backend generates OpenAPI at runtime through Springdoc. Web and mobile API types must remain synchronized with that API, but a live-only generation workflow can silently leave stale checked-in types when the backend is unavailable. Schema-only type generation also does not show API path, method, response-status, or security changes to reviewers.

## Decision

`api/openapi.json` is the reviewed canonical API contract baseline.

`scripts/check-openapi-contract.js` canonicalizes an OpenAPI document by sorting object keys before comparing it to the baseline. It can update the baseline only through `npm run api:spec:update`, which authenticates to the local development backend through the mobile login endpoint before reading `/v3/api-docs`.

`scripts/sync-api-types.js` deterministically generates both platform-local type files from the baseline. `npm run sync:api-types:check` fails when either generated file differs from the expected output.

CI packages and starts the backend, authenticates, verifies the live document against the baseline, and verifies generated type freshness.

## Consequences

Backend endpoint and DTO changes require these steps in the same change:

```bash
./gradlew bootRun
npm run api:spec:update
npm run sync:api-types
npm run sync:api-types:check
```

The gate intentionally rejects every unreviewed OpenAPI change, including backward-compatible additions. This makes API-review intent explicit. It does not replace behavioral integration or end-to-end tests.
