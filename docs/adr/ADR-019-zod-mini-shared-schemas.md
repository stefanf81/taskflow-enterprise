# ADR-019: `zod/mini` for the Shared Schemas

**Status:** Accepted

## Context

`@taskflow/schemas` (`shared/schemas/`) validates request and response payloads on both clients, and `AuthApi` imports it eagerly, so its dependencies land in the web app's initial bundle. With the classic `zod` API that was **112 KiB of the 216 KiB `main` chunk**: classic schemas carry every chainable method (and with them JSON-Schema generation and the other helpers), so none of it can be tree-shaken. Marking the package `sideEffects: false` would not help, because the schema sources themselves are only 4.2 KiB.

A minimal object schema built with classic `zod` bundles to 26.2 kB gzip; the same schema with `zod/mini` to 6.1 kB.

## Decision

1. **Write the shared schemas with `zod/mini`** (same `zod` 4 package, functional API): `string().check(trim(), minLength(1, msg), email(msg), maxLength(100))`, `optional(x)`, `array(x)`, `union([...])`, `int(msg).check(gte(...), lte(...))`, `object({...}).check(refine(fn, { path, message }))`, and `pipe(nullish(string()), transform((v) => v ?? ""))` for fields the backend omits (`omittedAsEmptyString()`).
2. **Keep the check order of the classic chains.** It decides which issue comes first, and the clients show `issues[0]`; the old and new schemas were compared side by side and produce the same issues and messages.
3. **Export list schemas** (`serviceItemResponseListSchema`, `barberResponseListSchema`, …) instead of calling `.array()` in the apps; `zod/mini` schemas have no `.array()`, and a module-level schema is built once instead of on every call.

## Consequences

### Positive
- Web initial bundle 461 → 394 kB raw (123 → 107 kB transfer) before the eager-landing change; the mobile bundle also loses the classic API.
- `parse`, `safeParse`, `.shape` and Standard Schema (`~standard`) still work, so `httpResource` parsing, `react-hook-form`'s `zodResolver` and the transport-boundary checks are unchanged.

### Negative
- A slightly more verbose API, and new contributors may reach for classic chain methods that do not exist on `zod/mini` schemas (the type checker catches it).
- One message changed: a non-number value for the review `rating` now reports "Rating must be a whole number" instead of the generic "expected number". The forms always send numbers.

## Verification

- Frontend lint/strict `tsc`, 316 unit tests and 11 Playwright tests; mobile `tsc` and 523 Jest tests (including the `zodResolver` login and register forms).
- BENCHMARKS.md §58 (bundle sizes and page-load measurements).
