# ADR-003: Denormalized Customer Name (Not a Separate Users Table)

**Status:** Accepted

## Context

The appointment booking system stores customer information (`customerName`, `customerEmail`, `customerPhone`) directly as columns on the `appointments` table, rather than referencing a separate `customers` or `users` table via a foreign key relationship.

The booking flow is guest-facing — users do not need to create an account or log in to book an appointment. This is a deliberate product decision to minimize friction in the booking process.

## Decision

Keep customer data **denormalized on the appointment record**. The appointment entity stores customer name, email, and phone as direct fields rather than via a relationship to a separate customer/users table.

The rationale:

1. **Guest-facing booking** — there is no user account to reference at booking time. Requiring account creation before booking would add unnecessary friction.

2. **Historical accuracy** — a customer's name or email address may change over time. The appointment record should preserve the details as they were at the time of booking. A foreign key to a mutable `customers` table would either lose this history or require complex snapshot patterns.

3. **Simplifies the booking flow** — the service layer can insert an appointment directly without first checking for or creating a customer record. No transaction coordination across multiple tables is needed for the most common operation.

4. **Account linking via email** — if a customer later creates an account, the `customerEmail` field serves as the natural key to link past and future appointments to their account. Queries like "find all appointments for user X" use the email address.

## Consequences

### Positive
- **Simpler guest booking flow** — the booking endpoint is a single table insert with no preconditions.
- **Historical accuracy** — past appointments always reflect the customer's details at the time of booking.
- **No JOINs for common queries** — loading an appointment with customer details is a single row read, not a two-table join.
- **No synchronization issues** — there is no risk of orphaned customer records or inconsistent foreign keys.

### Negative
- **Updating customer details requires multiple row updates** — if a customer changes their email or name and wants that reflected in past appointments, every relevant appointment row must be updated individually.
- **Mild data duplication** — the same customer's information is repeated across multiple appointment rows, increasing storage slightly.
- **No referential integrity** — the database cannot enforce that a customer exists; application logic must validate email formats and required fields.
