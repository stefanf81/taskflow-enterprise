# What changed from the GitHub Actions + Harbor reference

This GHCR variant is a **separate reference**, not a patch that keeps Harbor in the runtime path. The Jenkins v10 lineage and GitHub Actions v1 policy engine remain historical context only.

| Existing Harbor element | GHCR equivalent in this project |
|---|---|
| `harbor.example.internal/quarantine/eclipse-temurin` | `ghcr.io/<owner>/quarantine/eclipse-temurin` |
| `harbor.example.internal/approved/eclipse-temurin` | `ghcr.io/<owner>/approved/eclipse-temurin` |
| `harbor.example.internal/application-candidates/<app>` | `ghcr.io/<owner>/application-candidates/<app>` |
| `harbor.example.internal/applications/<app>` | `ghcr.io/<owner>/applications/<app>` |
| Harbor robot usernames/passwords | `GITHUB_TOKEN` with explicit `packages: read/write` per job, plus package Actions access |
| Harbor private project ACL | GHCR per-package permissions and Actions access (not the same isolation semantics) |
| Harbor built-in vulnerability scanning | Explicit Grype/Syft scans in GitHub Actions; schedule periodic rescans separately |
| Harbor image signatures | Cosign OCI signatures and attestations attached to GHCR image digests |
| Harbor Kyverno pull secret | GHCR registry credentials (`ghcr-kyverno-pull`) for admission and workload `imagePullSecret` where necessary |

The policy version `2026-11-ghcr-v6` (current) is required for new application builds, including the current policy fingerprint. Historical `2026-11-ghcr-v5` and `2026-11-ghcr-v4` records can be used **only as comparison baselines** during base-image reapproval, never for new production application builds. No Harbor approvals or GHCR v2/v3 approvals are accepted. A first GHCR approved baseline must be securely bootstrapped. All examples under `examples/` use a fictional `example-org` and placeholder keys and are not deployable unchanged.

`base-image-approval.yml` and `application-release.yml` remain in the **central protected security repository**; the example app builds from its separate repository. Base approval verifies a previously signed approved digest; first-use bootstrap requires an independent, controlled procedure.

**Remaining limitations:** No GHCR write access is package-scoped merely because of the `quarantine/approved` path, no tag compare-and-swap is implemented, no external release-gate server is supplied, no independent supplier-provenance verifier is implemented, and no live Kyverno or GHCR image-signing integration has been validated. Do not enable unattended production signing until tested and accepted.

## Base-approval fingerprint and production migration (v6)

Approval records carry a fingerprint of the base-evaluation code, settings and tool pins. The precheck skips an already approved digest only when that fingerprint equals today's; otherwise the digest runs through the normal pipeline again. The previous baseline may be validated against the historical-baseline allowlist for comparison, but a new application build requires a v6 signature and today’s policy fingerprint. Reapprove the current approved digest before restarting application releases. Older GHCR v2/v3 approvals are not accepted; re-approve those digests as described in `docs/V4-HARDENING.md`.
