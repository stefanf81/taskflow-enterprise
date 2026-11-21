# GitHub Actions + GitHub Container Registry (GHCR) image approval — v6

> **Current release: v6 hardened reference.** This example is not a production-certification. See [docs/V6-SECURITY.md](docs/V6-SECURITY.md) for changes and migration prerequisites.

This is a **GHCR adaptation** of the GitHub Actions / Harbor reference. What changed in each version, and why, is in [CHANGES.md](CHANGES.md). It preserves the original image-comparison and approval policy engine, replaces the image storage and promotion paths with `ghcr.io`, and authenticates to GHCR with per-job `GITHUB_TOKEN` permissions. It is **a staging reference, not a turnkey production signing authority**.

## PoC changes (stefanf81 proof of concept)

This copy runs the v6 kit with the changes below and nothing else. They are what a first live
run on a personal GitHub account needs, plus fixes from two code reviews. The setup runbook and
run order are in the README of the source repository this one was exported from
(`stefanf81/base-image-gatekeeper`). Every file listed differs from the
kit; every other file is byte-identical.

| Change | Why |
|---|---|
| `catalog/Dockerfile.temurin` pins `eclipse-temurin:21-jre-resolute@sha256:577acb7a…` | The kit shipped it unpinned, which stops the precheck |
| `policy/applications.json`: `example-app` comes from `stefanf81/base-image-gatekeeper-app` | The toy application repository |
| `policy/config.json`: `"allow_self_approval": true`; `ci/environment_approver.py --policy` | Solo maintainer. The initiator may approve; the approver is recorded as `self:<login>` in every signed record. Part of the base fingerprint; default strict |
| `ci/audit_repo_settings.py` | With the switch on, "Prevent self-review" and a PR approval count of 0 are accepted (nobody can meet them alone); stale-review dismissal stays required whenever approvals are required, everything else is unchanged. The switch is read from `policy/config.json` on the audited repository's `main`; `--policy FILE` overrides that and says so |
| `.github/workflows/base-bootstrap.yml`, `ci/bootstrap_base.sh`, `scripts/approval_record.py --bootstrap` | The first approved baseline. Its record has `"bootstrap": true` and no fingerprint, so it is a comparison baseline only: the precheck and `scripts/verify_bases.sh` refuse it until the normal pipeline has evaluated and approved the digest. Refuses, before writing anything, when a baseline or a usable approval already exists |
| `scripts/evaluate.py` | When the candidate IS the approved baseline (first approval after the bootstrap, or a re-approval after a policy change), every diff check is silent, so the candidate's absolute SUID/SGID files, world-writable paths, symlinks into watched locations and Critical/High/unknown findings become review reasons (never blocks) |
| `.github/workflows/base-image-approval.yml` | The push trigger lists every fingerprinted file (six were missing: a change to them invalidated the approval without a re-run), and the `evaluate` summary shows all block and review reasons |
| `scripts/reproducible_build.sh` | Builds with the current docker context's builder. The kit named `default`, which buildx refuses once `docker/setup-docker-action` has switched the context |
| `.github/workflows/application-release.yml` | `authorize` captures main's HEAD before comparing, so a failed API call (e.g. an expired token) reports gh's error, not "not the exact protected main HEAD" |
| `examples/Dockerfile.application` | `COPY --chmod=0444` for the jar: `image_build` runs under `umask 077`, so a plain COPY leaves it unreadable for the non-root user |
| `tests/test_poc_changes.py` (new); `tests/test_gha_workflows.py` (workflow set and list), `tests/test_v4_hardening.py`, `tests/test_v5_fixes.py`, `tests/test_v6_hardening.py` (`base-bootstrap.yml` added to their workflow lists; cosign call count 5 → 7); `tests/test_v3_fixes.py` (allowlist value) | Regression tests for the above |
| `README.md` (this table), `CHANGES.md`, `docs/SETUP.md` | Documentation of the above |
| `SHA256SUMS.txt` removed | It described the unmodified kit |

## Architecture

```text
Public upstream image (e.g., Docker Hub Eclipse Temurin, pinned sha256)
  -> Renovate PR -> protected main
  -> GitHub Actions base-image-approval.yml
       precheck (read): already approved under an accepted policy version? -> stop
       quarantine (write): copy exact upstream index to ghcr.io/<org>/quarantine/eclipse-temurin
       evaluate (read-only): verify previously signed baseline, then
       -> compare previous/candidate on all Linux platforms:
          diffoci + crane + syft + grype + full filesystem metadata inventory
       -> BLOCK / REVIEW / AUTO_PASS
       -> protected promotion + Cosign approval signature/attestation
       -> ghcr.io/<org>/approved/eclipse-temurin@sha256:...

Application source (allowlisted in policy/applications.json, exact main SHA + signed release gate)
  -> application-release.yml (protected central security repository), dispatched with app_name
       -> authorize: the only job with the source read token; hands on a hash-pinned git archive
       -> two independent compiles and two independent container builds
       -> GitHub signed artifact attestations (TAR, image CONFIG digest, base-image lists)
       -> scan (read-only): compare builder outputs, layer analysis, Syft/Grype
       -> push_candidate (write): push the exact attested TAR, unsigned, to
          ghcr.io/<org>/application-candidates/<app>@sha256:...
       -> high CVE review if required (reviewer of that environment, not the dispatcher)
       -> verify both attested builder config digests against the candidate manifest
       -> copy exact digest to ghcr.io/<org>/applications/<app>@sha256:...
       -> independent fresh Grype scan + separately signed scan evidence
       -> protected Cosign image signing + SBOM/build attestation
  -> Flux/Kubernetes deploys immutable application digest
  -> Kyverno enforces GHCR image references, signatures and signed claims
```

Image folders such as `quarantine/` and `approved/` are naming conventions. **GHCR does not turn those paths into Harbor-style security projects**. A package's Actions access must be configured separately, and one repository's `GITHUB_TOKEN` can have write access to multiple packages. The *signing identity plus Kyverno* is a separate, indispensable security boundary; use separate security repositories/identities where stronger publishing separation is required.

## Included files

- `.github/workflows/base-image-approval.yml`: upstream image quarantine, multi-platform comparison, approval and signed promotion.
- `.github/workflows/application-release.yml`: independent builds, GitHub attestations, candidate publication, verifier and signer.
- `.github/workflows/security-pr.yml`: unprivileged security-repository PR checks.
- `ci/base_precheck.sh`, `ci/base_quarantine.sh`, `ci/base_evaluate.sh`, `ci/base_promote.sh`, `ci/application_pipeline.sh`: workflow implementation.
- `ci/image_tar_identity.py`, `ci/check_registry_config.py`: image config digest of a saved archive and its comparison with the registry manifest.
- `ci/check_additive_layers.py`: proves that application layers never change a base-image file (required before a base-image CVE exception applies to an application).
- `ci/app_config.py` + `policy/applications.json`: the protected allowlist of releasable applications.
- `ci/source_archive.py`, `ci/environment_approver.py`: source hand-over without tokens; reviewer of one named environment.
- `ci/audit_repo_settings.py`: checks repository security, including main-branch PR reviews and mandatory checks (run as admin).
- `ci/install_verified_tools.py` + `ci/toolchain.lock.json`: installs crane, cosign, Syft, Grype, diffoci, gh and actionlint from exact release URLs, only when size and SHA-256 match the lock. `ci/require_tools.sh` refuses a copy of those tools from the runner image.
- `ci/common.sh`: the cosign v3 signing flags and the digest-checked `crane` copy used for quarantine, approval and promotion.
- `scripts/policy_fingerprint.py`: fingerprint of the base-evaluation code, settings and tool pins. The precheck uses it to decide whether an already approved digest must be evaluated again.
- `scripts/`: existing defensive Dockerfile checks, diffoci/Crane/Syft/Grype comparison, policy evaluation, Cosign claim verification.
- `catalog/` and `renovate.json`: Renovate digest-pinned upstream image source.
- `examples/`: application Dockerfile, app CI, Renovate and Kyverno image-validating policies, including Audit variants.
- `docs/SETUP.md`: exact GHCR package access, variables, environments, bootstrap and EKS configuration.
- `docs/THREAT-MODEL.md`: residual security limits and go-live conditions.
- `docs/REFERENCES.md`: official implementation guidance.

## Run offline checks

```bash
bash ci/validate-local.sh
```

This checks Python and Bash syntax, parses YAML and JSON, and runs the included unit tests. The PR workflow also runs pinned, checksum-verified `actionlint`. v5 was additionally run locally with the pinned tool versions on real Temurin images (see CHANGES.md). Live staging tests against GitHub, GHCR, Cosign and Kyverno remain mandatory.

## Before running workflows

1. Create a protected GitHub security repository and a lowercase `GHCR_NAMESPACE` variable, e.g. `acme`.
2. Set required GitHub environments, rulesets and permissions, then run `ci/audit_repo_settings.py --repo OWNER/REPO` as a repository admin until it passes. Configure *Manage Actions access* on every existing private GHCR package so this repository can pull/push as needed. Only the jobs that copy, push or sign request `packages: write`; every job that parses image content uses `packages: read`.
3. Add each releasable application to `policy/applications.json` through a reviewed pull request.
4. Create the approval, verifier, app signing and release-gate keys as described in [setup](docs/SETUP.md). The example uses key-based Cosign; in production prefer isolated KMS/HSM identities.
5. Nothing to fill in for the tools: `ci/toolchain.lock.json` pins every one of them (URL, size, SHA-256), checked against the publishers' checksum files. Before you rely on them, verify those checksum files' signatures yourself (see "Pinned tools" in [setup](docs/SETUP.md)). There are no mutable "latest" downloads.
6. Bootstrap the first verified, signed base digest separately: a newly discovered upstream digest cannot be compared to a non-existent baseline. A baseline bootstrapped for v4 is accepted as it is. v2/v3 approvals are not accepted; re-approve those digests. After that, changes to the base-evaluation code or settings never need another manual bootstrap: the next run re-evaluates the approved digest through the normal pipeline.
7. Validate GitHub artifact-attestation eligibility and the external release authorization service before dispatching an app release.
8. Test all Kyverno rules in Audit in staging before applying Deny.

**Not automatic malware detection:** a malicious change inside a legitimately signed upstream release can still pass; comparison, signatures, scanning and manual review only reduce risk.

## Remaining boundaries

See the [hardening notes](docs/V4-HARDENING.md) and the [threat model](docs/THREAT-MODEL.md). This is still a staging reference: one security repository's `GITHUB_TOKEN` is **not package-scoped**, independent verifier and release-gate services must be operated and assessed separately, namespace admission selectors must be protected with RBAC, and signed images require continuous rescanning and revocation procedures.
