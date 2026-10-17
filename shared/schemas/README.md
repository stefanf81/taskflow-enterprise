# @taskflow/schemas

Shared Zod validation schemas and TypeScript types for the **TaskFlow Enterprise** ecosystem.

## Overview

`@taskflow/schemas` is a local workspace package (`shared/schemas/`) providing single-source-of-truth runtime validation schemas and static types shared across:
- **Web Frontend (`frontend/`):** Validates HTTP API request payloads, incoming `httpResource` API responses, and Server-Sent Events (SSE).
- **Mobile Application (`mobile/`):** Validates transport boundaries (`mobile/src/api/contracts.ts`) for Axios REST responses and form inputs.

## Structure

```text
shared/schemas/
├── src/
│   ├── index.ts        # Re-exports all schemas and types
│   ├── appointment.ts  # Booking creation, updates, SSE events, and dashboard models
│   ├── auth.ts         # Login, registration, and user identity models
│   ├── catalog.ts      # Services and barber catalog models
│   └── review.ts       # Customer reviews and barber ratings models
├── package.json
└── package-lock.json
```

## Usage

### Installation in Consumer Packages

Referenced in `frontend/package.json` and `mobile/package.json` as a local file dependency:

```json
"dependencies": {
  "@taskflow/schemas": "file:../shared/schemas"
}
```

> **Important:** Always run `npm ci` in `shared/schemas/` first before running `npm ci` in `frontend/` or `mobile/`.

### Consuming in TypeScript / Frontend / Mobile

```typescript
import {
  appointmentCreateSchema,
  appointmentResponseSchema,
  type AppointmentCreateRequest,
  type AppointmentResponseItem
} from '@taskflow/schemas';

// Runtime validation
const validatedPayload = appointmentResponseSchema.parse(rawApiResponse);

// Static typing
function submitBooking(req: AppointmentCreateRequest) {
  appointmentCreateSchema.parse(req);
  // ...
}
```

## Conventions (`zod/mini`)

The schemas are written with `zod/mini`, the functional API of the same `zod` 4 package (ADR-019). The classic chainable API cannot be tree-shaken and was 112 KiB of the web app's 216 KiB `main` chunk; `zod/mini` keeps only what is used.

- Build schemas with functions and checks: `string().check(trim(), minLength(1, 'Name is required'), maxLength(100))`, `optional(x)`, `nullish(x)`, `array(x)`, `union([...])`, `object({...}).check(refine(fn, { path, message }))`. Classic methods such as `.min()`, `.optional()` or `.array()` do not exist on these schemas (the type checker rejects them).
- Keep the order of checks: it decides which issue comes first, and both clients show `issues[0]`.
- Fields the backend omits but the clients treat as text use `omittedAsEmptyString()` (`nullish` piped into `""`).
- Lists have exported schemas (`serviceItemResponseListSchema`, `publicBarberResponseListSchema`, `barberResponseListSchema`, `barberRatingResponseListSchema`, `notificationOutboxResponseListSchema`, `barberTimeOffResponseListSchema`). Use them instead of building `array(...)` at the call site, so each list schema is created once. Add one next to any new item schema that is returned as a list.
- `parse`, `safeParse`, `.shape` and Standard Schema (`~standard`) work as before, so Angular `httpResource` parsing and `react-hook-form`'s `zodResolver` need no changes.

## Quality Gates

To verify that the shared package dependencies are intact and lockfiles are clean:

```bash
cd shared/schemas
npm ci
```
