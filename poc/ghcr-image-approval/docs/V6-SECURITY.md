# GHCR Image Approval v6 — Hardened reference and migration

> Not a production-certified system. Local unit/static validation is not a substitute for
> real GitHub Actions → GHCR → Cosign → Kyverno admission/integration testing.

## Changes from v5

1. **F1 — both independently built image archives are independently content-verified.**
   `ci/image_tar_identity.py` streams every layer of each Docker-save archive, validates
   both its content-addressed blob hash (when it has a `blobs/sha256/…` filename) and
   its uncompressed SHA-256 against the corresponding ordered `rootfs.diff_ids` from
   the config. Gzip layer payloads are supported. Unsupported zstd, corrupt payloads,
   missing layers or exceeded budgets fail closed. The scanning job explicitly compares
   the validated ordered layer sequences across builders. Matching config digests
   alone no longer pass a tampered archive. This establishes equality of verified
   config and uncompressed layers, **not byte-for-byte reproducibility of compressed OCI
   manifests, compiler trust, upstream safety, or independent SLSA provenance**.
2. **F2 — layer-order validation.** `scripts/check_application_vulnerabilities.py`
   verifies the overlay report's exact ordered base `diff_ids`, not their sets.
   Reordered layers now invalidate inherited base-image vulnerability exceptions.
3. **F3 — approval reruns.** The environment-review helper rejects either the
   original workflow actor (`GITHUB_ACTOR`) or the rerun initiator
   (`GITHUB_TRIGGERING_ACTOR`), ignoring login case. GitHub environments still need
   self-review prevention, required reviewers, and properly restricted bypass rights.
4. **F4 — historical approval isolation.** New application builds may consume only
   records signed under `2026-11-ghcr-v6` with a policy fingerprint equal to the
   current protected base-evaluation policy. GHCR v5/v4 signatures may be read ONLY
   as historical baselines during comparison and reapproval, never as authorization
   for new application builds. Old GHCR v2/v3/Harbor approvals remain untrusted.
5. Production-consumption approvals have a **30-day expiry** by example policy;
   historical baseline references have a maximum age of **365 days**, for comparison
   only. Adjust these reviewed values to organizational SLAs. This pipeline does not
   currently include periodic rescanning/reapproval automation; applications will
   fail closed after current approval expiry until reapproval succeeds.

## Migration / rollout

- Back up the signed baseline, export its immutable digest and validate its provenance
  as a *historical comparison* input. Do not allow old approval versions into a new
  application-release job.
- Change the protected central security repository to v6 and run the upstream/base
  approval workflow against the **existing** GHCR approved base digest. This may
  produce a new v6 approval for the same bytes after explicit review. If the previous
  approval is older than 365 days, require a documented independent bootstrap; the
  pipeline fails closed rather than treating that baseline as trusted.
- Verify `scripts/verify_bases.sh` succeeds on the approved base before allowing new
  application builders to start. The signed record must carry v6 policy version and
  current `scripts/policy_fingerprint.py` hash. Any change to fingerprinted policy
  code requires reapproval before applications can consume the digest.
- Validate real GitHub Environment actor/rerun behavior and full Kyverno CEL and
  Cosign v3 image/attestation evidence on a staging cluster before enabling Deny.
- Add periodic, independently authenticated vulnerability rescanning, revocation,
  and a deployed-image inventory before production use.

## Known remaining production requirements (not solved by a ZIP)

- **GHCR publication isolation**: `packages: write` is not automatically limited to
  an `approved/` or `quarantine/` image path. Use separate protected identities and
  package permissions, and test them with negative publication attempts.
- **Provenance**: upstream vendor provenance verification is not implemented; the
  workflow correctly forces manual review. Two matching builds are not independent
  compiler/toolchain attestation or proof that the original source is benign.
- **External release authorization**: a separately secured signed release-gate
  service (including revocation and audit logs) must be deployed and tested.
- **Runtime**: exact Kyverno version/expressions, Cosign signatures/referrers,
  GHCR private pull secrets, namespace protections, init/ephemeral containers and
  mixed-image Pods require real admission tests.
- **Registry operations**: GHCR tag promotion is not atomic, and malicious code
  may escape heuristics that compare image files/packages.
- **Toolchain**: checksum-pinned tools authenticate a reviewed lock, not the
  upstream release publisher unless independently verified when updating pins.
