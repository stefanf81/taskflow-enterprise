# CI / CD Documentation

Prose documentation for the GitHub Actions pipelines. The executable workflow
definitions live in [`.github/workflows/`](../../.github/workflows/); this
directory holds the rationale, design notes, and audit history that would
otherwise clutter that directory.

## Index

| Document | Description |
|----------|-------------|
| [overview.md](overview.md) | Design rationale for `.github/workflows/ci.yml` and the related security, DAST, external-scan, and publication workflows: triggers, concurrency, permissions, caching, and hardening choices. |
| [audit-2026-08-20.md](audit-2026-08-20.md) | Point-in-time security/correctness audit of every workflow, with per-finding status. Historical artifact — not a live status board. |

## Related

- Workflow definitions: [`.github/workflows/`](../../.github/workflows/)
- Architecture decisions: [`docs/adr/`](../adr/)
- Repository overview: [`README.md`](../../README.md)
