> Historical v4/v5 guide. For current v6 production migration consult docs/V6-SECURITY.md.

# GHCR image approval v4 hardening: security fixes, migration and acceptance criteria

> **Updated for v5.** v4 as shipped could not complete a base approval; CHANGES.md lists why and what changed. Where this page differs from v4 it says so.

**Starting point:** exact uploaded `ghcr-image-approval-github-actions-v3.zip` (not generated from memory).

## Fixed in repository code

| Prior finding | Fix | Verification |
|---|---|---|
| H1 whiteout of implicit ancestor | Effective base tree includes implicit parents; `.wh.X` evaluates all descendants; directory metadata changes prevent inherited CVE exemptions | `tests/test_v4_hardening.py` synthetic OCI layer tests |
| H2 creation-only rulesets | `ci/audit_repo_settings.py` requires effective main PR checks/reviews and denies bypass actors in accepted rulesets; can alternatively verify strict branch protection | Negative settings tests |
| H3 missing binary provisioning | Checksum-locked installer with explicit release URLs, bounded downloads, no shell execution of downloaded scripts. v5: every tool is pinned (including gh), sizes are in the lock, skopeo is replaced by the pinned crane | Fails on missing/forged hashes; offline tests; real download and install of all tools |
| M2 obsolete approved-digest shortcut | Signed approval includes a SHA-256 fingerprint of the base-evaluation code, settings and tool lock. v5: it is checked before the skip only; the previous baseline is validated by policy version, and application-side files are not part of it | Negative hash mismatch tests; functional precheck/evaluate tests |
| M3 unbounded parsing | Bounds for TAR paths, per-layer entries/bytes, image archive member count, flattened filesystem inventory size. v5: an application image over the layer-analysis bounds is released without inherited exceptions instead of being blocked | Budget-exceed tests |
| L2 no workflow semantic check | Security PR workflow runs pinned, SHA-256-verified actionlint | Static checks (actual GitHub Action execution not tested) |

The current policy version is `2026-11-ghcr-v5`; v4 approvals are accepted as baselines, v2/v3 approvals are not.

## Mandatory configuration before staging

1. `ci/toolchain.lock.json` is complete in v5: all seven tools have URL, size and SHA-256, compared with the publishers' checksum files. Verify those checksum files' signatures independently before production use, and before adding or updating a lock entry. Tool version changes alter the approval fingerprint, which makes the next run re-evaluate the approved digest.
2. Protect main with mandatory PR reviews, stale-review dismissal and CI checks, then run `GH_TOKEN=<admin-token> python3 ci/audit_repo_settings.py --repo OWNER/REPO`. Review bypass lists and inherited organizational rulesets manually. Do not deploy on an audit failure.
3. Rebuild the trust baseline if it is older than v4: inspect the current approved digest and upstream source, verify it independently, and have a separate security approver sign/attest its digest under the current policy. **Do not reuse/relabel an existing v2/v3 signature.** A baseline already bootstrapped for v4 needs nothing: v5 accepts it and re-evaluates it through the pipeline when the fingerprint differs.
4. In GitHub packages, restrict Actions access per package and perform a negative test: can the candidate-writer identity write to the approved package? If yes, isolate writing with separate repositories/apps/identities or retain Harbor for project-scoped robot identities. Image-path naming is not security isolation.
5. Validate Kyverno 1.20+ CEL rules for Pods, init containers, sidecars, ephemeral containers, revoked digests, namespace coverage, immutable digest references and claim matching. Lock namespace security labels with cluster-admin RBAC and independent namespace policy.
6. Integrate an independent protected verifier/release authorization service. The on-repo verifier still consumes scan JSON from another worker: a compromised scanner can fabricate a report. Use independent registry scanning in a separate trust domain for production signing authority.
7. Run real end-to-end GitHub Actions → GHCR → Cosign → Kyverno/EKS staging jobs, including large multiarch images and malformed/compressed TAR input. Unit tests and YAML parsing cannot prove runtime compatibility.

## Residual risks from v3 review (not fixed by changing a ZIP)

- **M1:** `GITHUB_TOKEN` package writes cannot be constrained by an OCI path in a repository that has wide package access. A separate application permission architecture is needed.
- **M4:** The protected verifier is only as trustworthy as its source scan evidence; crypto signing a report does not independently prove a scanner examined the image.
- **M5:** Kyverno namespace-selector coverage depends on cluster RBAC/policy, and live admission semantics are still unverified.
- **M6:** Rescanning already approved/deployed digests and revoking compromised approvals needs a monitored operational service, alerts, and a production incident playbook; no automated revocation is included here.
- **L1:** The organization's SAST/DAST execution and independent release-gate issuer are external integrations and intentionally cannot be fabricated in an example.
- **L4:** Application build verification is currently single-platform; deploy only on that supported platform or implement an independent multi-platform application build and attest each platform/index.

## Outcome

The local suite validates code logic and regression behavior only. A properly configured and tested staging deployment is required before any real signing key or production namespace is used.
