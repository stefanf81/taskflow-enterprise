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

## Quality Gates

To verify that the shared package dependencies are intact and lockfiles are clean:

```bash
cd shared/schemas
npm ci
```
