# v6 fixes (2026-11-18)

- Verify **every actual (possibly gzip-compressed) layer byte stream** in both builder Docker-save archives against the ordered `rootfs.diff_ids`, before comparing identities or allowing publishing. Explicit verified layer-sequence comparison. Fail closed on unsupported zstd layers or analysis byte budgets.
- Compare base-layer sequences in original order when deciding whether inherited CVE exceptions apply.
- Reject **original** `GITHUB_ACTOR` and rerun `GITHUB_TRIGGERING_ACTOR` when evaluating reviewer identity.
- Introduce explicit current approval vs historical comparison-only approval policy. New application builds require v6 signed approval and the current protected base-policy fingerprint. v4/v5 approvals are historical comparison inputs only.
- Replace related v5 security assumptions in tests and documentation; add regressions.

---

# Changes in v5 (fixes for the v4 code review)

Every finding has regression tests in `tests/test_v5_fixes.py` (one test class per number
below).

v5 was also run locally with the exact tool versions from `ci/toolchain.lock.json`,
installed by `ci/install_verified_tools.py` over the network, against Docker 29.9.3, a local
registry and two real Temurin 21 JRE releases:

- **Base flow:** precheck → quarantine → evaluate (all four platforms) → promote with real
  cosign signing → precheck again.
- **Application flow:** authorize → compile → two image builds → scan → push → promote →
  rescan → verify → sign with real cosign.

What the run showed:

- The installer downloaded and installed every tool; `require_tools.sh` ran in its strict
  mode.
- Base flow: the baseline was a v4-style record (policy version v4, a different
  fingerprint). The new Temurin release was evaluated on all four platforms (REVIEW),
  promoted, signed and attested. The precheck then answered `approved`. Adding an
  application left it at `approved`. A change to `scripts/evaluate.py` made it `needed`,
  and the same digest was evaluated and signed again through the pipeline, with no manual
  bootstrap.
- Application flow: both builders produced the same config digest, the real
  `verify_bases.sh` accepted the base, and the release was signed. `cosign verify` and
  `cosign verify-attestation` (SBOM and build record) then passed on the signed image.
- The new diffoci check caught two real failures during the run (registry rate limits,
  HTTP 429), which v4 would have recorded as an empty diff.

Harness adaptations, outside the package: a local plain-HTTP registry instead of GHCR (so
`require_ghcr_config.sh` was bypassed), images handed to diffoci with `diffoci load` because
it cannot pull over plain HTTP, and a stub serving the signed release-gate grant.

Nothing was run against GitHub Actions, GHCR or Kyverno, and `gh attestation verify` was
stubbed (it needs GitHub).

## High

1. **The installer could not install cosign, and three pins were empty.** The binary limit
   was 120 MiB and the cosign v3.1.4 binary is 139 MiB; diffoci was listed as `tar.gz` but
   is released as a bare binary.
   - The lock is now complete: crane, cosign, Syft, Grype, diffoci, gh and actionlint each
     have URL, size and SHA-256, compared with the publishers' checksum files.
   - Limits are 256 MiB. The lock records each file's size, so `validate_lock` and a unit
     test prove offline that every pinned file fits.
   - The installer checks size and hash, retries transient download errors, and exports
     `VERIFIED_TOOLS_DIR`.
   - Also fixed: v4 installed crane and Grype for `rescan` and crane for `push`, while
     `require_tools.sh` demanded cosign and gh for both, so those two jobs could not pass.
     `require_tools.sh` now takes its list from the installer, and a test checks every
     pipeline function only runs tools its job installs.
2. **cosign v3 rejected the signing commands.** `--tlog-upload=false` alone is an error in
   cosign v3. All five `cosign sign` / `cosign attest` calls now use one shared flag set in
   `ci/common.sh`: `--yes --use-signing-config=false --tlog-upload=false`. cosign v3 stores
   the result in its new bundle format; SETUP.md says to test Kyverno against it.
3. **`evaluate.py` crashed on the real Temurin image.** Syft reports the JDK as a
   `java-jvm-installation` whose file list is plain strings. `file_owners()` now only takes
   package-manager records (objects with a `path`); the JDK tree stays under
   `vendor_managed_prefixes`.
4. **The policy fingerprint locked out base approval after any change.**
   - The fingerprint is now checked in the precheck only, where it decides whether an
     already approved digest is evaluated again. Evaluate and promote validate the previous
     baseline by accepted policy version, as before v4.
   - It now covers only what can change a base decision: the base workflow, the scripts it
     runs, the installer and tool lock, and the base-relevant part of `policy/config.json`.
     The application allowlist, application exceptions, the release workflow and the PR
     workflow are not part of it. A test checks the file list is closed under references.
   - Policy version is `2026-11-ghcr-v5`; a baseline bootstrapped for v4 is still accepted.

## Medium

5. **The settings audit passed four weak configurations.**
   - A ruleset without a `bypass_actors` field is no longer evidence; the failure message
     says how many rulesets were ignored for that reason.
   - Creation rulesets fail when any repository role other than admin can bypass them.
     Teams, apps and deploy keys are printed as `CHECK MANUALLY` lines.
   - Classic branch protection fails when it has pull-request bypass allowances.
   - Environments must use a custom policy of exactly `main`; "protected branches only"
     fails.

## Low

6. **The analysis size limits blocked the release.** A layer over the entry, byte or path
   limits now makes `check_additive_layers.py` report `additive: false` (no inherited
   base-image exceptions) and exit 0. Malformed input still fails.
7. **A failed diffoci run went unnoticed.** diffoci 0.1.8 exits 1 for "differences found"
   and for errors. `compare.sh` now fails when the run logged `level=fatal`, or exited 1
   without printing a difference table.
8. **`skopeo` and `gh` came from the runner image.** skopeo has no release binary to pin, so
   the three copies now use the pinned `crane copy` through `copy_exact` (`ci/common.sh`),
   which hashes the destination's manifest bytes itself. gh v2.105.0 is pinned and
   installed in every job that calls it, and `require_tools.sh` refuses a pinned tool that
   resolves outside the verified directory.
9. **Stale docs.** MIGRATION-FROM-HARBOR.md, the example release predicate, the audit
   script's docstring, README, SETUP.md and V4-HARDENING.md now describe v5. SETUP.md has a
   new "Pinned tools" section.

## Found while testing v5

10. **The sign job rejected every GHCR application image.** `create_application_build_record.py`
    only accepted Harbor-shaped references (`host/applications/app`), never
    `ghcr.io/<owner>/applications/app`. It had no tests, and the earlier reviews missed it; it
    showed up when the sign job ran for real. The script now takes the pipeline's release
    and candidate repositories and requires exactly those.

---

# v4 changes (2026-11-18)

The supplied `ghcr-image-approval-github-actions-v3.zip` was used as the exact starting point.

- **H1:** OCI whiteout checks include implicit ancestor directories and all base descendants. Existing base directory metadata must match; otherwise no inherited base-image exceptions. Added TAR member, path, layer and uncompressed-byte budgets.
- **H2:** Repository audit now requires demonstrable main-branch PR reviews and status checks, through an active non-bypassed ruleset or enforced branch protection, in addition to branch/tag creation restrictions.
- **H3:** `ci/install_verified_tools.py` installs protected, fixed-release, SHA-256-verified security tools on GitHub-hosted runners. `ci/toolchain.lock.json` has real release checksum pins for Syft, Grype and actionlint; operators must supply verified crane, cosign and diffoci asset hashes before any privileged workflow succeeds. No unverified fallback.
- **M2:** Signed base approvals include a fingerprint over policy, protected scripts, security workflows, and toolchain lock. The precheck and promote gate demand the same fingerprint. Older v2/v3 attestations are intentionally not accepted under v4.
- **M3:** Additional resource limits for layer processing, image archive member enumeration and filesystem inventories; they fail closed on oversized/untrusted inputs.
- **L2:** Added checksum-verified `actionlint` in the unprivileged security PR checks.
- **Tests:** New adversarial tests for the whiteout, audit, approval-hash and installer regressions.

**External production tasks remain:** GHCR package write isolation via separate principals/repos, independently operated release gate and verifier, validated Kyverno coverage and namespace authorization, continuous rescanning/revocation, and E2E GitHub/GHCR/EKS testing. These cannot be assumed solved by changes to repository YAML.

See `docs/V4-HARDENING.md` for migration and threat-model details.

---

# Changes in v3 (fixes for the v2 code review)

Every finding has regression tests in `tests/test_v3_fixes.py` (one test class per number
below). The full application flow (authorize → compile → image build → scan → push →
promote → rescan → verify) was also run locally against a real Docker 29.9.3 daemon with
the containerd image store, a local registry and the real `crane`, with stubs only for
`gh`, `cosign`, `syft`, `grype` and `skopeo`. Nothing was run against GitHub Actions, GHCR
or Kyverno.

## High

1. **Every application release failed at promote.** The builders attested
   `docker image inspect .Id`, which with the containerd image store is the OCI *manifest*
   digest, and promote compared it with the registry manifest's `config.digest`, so the two
   could never be equal. The builders now read the **config digest** from their own saved
   archive (`ci/image_tar_identity.py`, which also checks that the config bytes hash to their
   name, that the layer count matches `rootfs.diff_ids` and that the OCI index names the same
   config) and attest `image-evidence/config-digest.txt`. Scan, push, promote and rescan all
   compare against that value. `ci/check_registry_config.py` documents why `.Id` must not be
   used. There is a Docker-backed test that shows `.Id` ≠ config digest and that two
   honest builds give the same config digest.
2. **Actions were pinned by tag.** That included the third-party
   `docker/setup-docker-action`, in the job that holds `id-token: write` and
   `attestations: write`. Every `uses:` in the workflows and in the example application
   workflow is now pinned to a full commit SHA with the version in a comment. They were
   also moved to the current Node 24 majors: checkout v7.0.1, upload-artifact v7.0.2,
   download-artifact v8.0.2, attest v4.2.2 and setup-docker-action v5.7.0, because the v4
   lines of checkout and the artifact actions run on Node 20, which has reached end of
   life. The Docker engine is pinned to v29.9.3 for both builders. Tests reject tag pins,
   a missing version comment, and two different pins for the same action.

## Medium

3. **Jobs that parse untrusted images held `packages: write`.**
   - **Application:** `scan` is now read-only and uses no Docker daemon. It reads the
     attested archive directly: `docker-archive:` for Syft and Grype, plus the layer
     analysis. It also computes the digest `crane push` will produce (`crane digest --tarball`).
     A new `push_candidate` job (`ghcr-candidate-writer`, `packages: write`) re-verifies the
     archive's attestation and hash, pushes it, and must get exactly that digest. It runs no
     scanner.
   - **Base image:** the new `quarantine` job (`ghcr-quarantine`, write) only copies the
     pinned digest (`ci/base_quarantine.sh`). `evaluate` is now read-only and has no
     environment.

   Tests assert the full set of jobs that can write packages.
4. **Base-image exceptions were never inherited by applications.** A `base_image_ref`
   exception now applies to an application finding only when both of these hold:
   - Grype found the package in a base layer.
   - `ci/check_additive_layers.py` proved that the application layers are purely additive:
     no base path is overwritten, deleted by a whiteout or hidden by an opaque whiteout,
     nothing is written through a base symlink, and every layer's uncompressed SHA-256
     matches its `diff_id`.

   The scan job produces that report from the builder archive, and the rescan job produces
   it again from the image it pulls from the registry. The independent verifier binds the
   report into its signed record (`layerOverlaySha256`, `baseFilesUnmodified`), and the
   signer re-checks it. Images that are not additive still release normally, but they need
   `image_ref` exceptions. That workflow is documented in SETUP.md: a blocked run prints its
   reproducible digest. The policy version is now `2026-11-ghcr-v3`. v2 base approvals are
   still accepted because base evaluation did not change.
5. **One application per security repository.** The release is dispatched with
   `app_name`. Source repository, Dockerfile and build outputs come only from
   `policy/applications.json` on protected `main` (`ci/app_config.py`, strict schema and path
   checks). Concurrency is per application, and the `APP_*` repository variables are gone.
6. **No "already approved" short-cut for base images.** A new read-only `precheck` job
   (`ci/base_precheck.sh`) stops the run when the pinned digest is already the approved one
   and carries a valid approval under an accepted policy version. Pushes to `policy/`,
   `scripts/` or `ci/` no longer ask reviewers to re-approve and re-sign the same digest.

## Low

7. **Approver lookup took the last approval from any environment.**
   `ci/environment_approver.py` counts only approvals of the named environment, needs
   exactly one approver, and rejects the person who triggered the run. Both workflows use
   it, and SETUP.md now requires "Prevent self-review".
8. **Scan trusted base lists from builder a that were not attested.** The builders now
   attest `base-images.txt` and `final-base.txt` together with the archive and the config
   digest. Scan verifies all of these files from both builders and requires them to be
   identical.
9. **The RepoTags guard was gone.** `docker load` is no longer used anywhere. Every reader
   of a builder archive requires exactly one image whose `RepoTags` are exactly
   `[local-application:<commit>]`.
10. **The candidate digest came from a tag lookup.** The push job takes the digest from
    `crane push --image-refs`, and it must equal the digest the scan job computed before
    the push.
11. **Verification freshness was hard-coded to 10 minutes.** It is now
    `verification_max_age_minutes` in `policy/config.json` (default 30, allowed range
    1–1440), read through `scripts/policy_info.py`.
12. **`APPLICATION_READ_TOKEN` was needed in two environments.** Only the `authorize` job
    (`application-source-read`) holds it now. It hands the exact commit on as a `git archive`
    whose SHA-256 travels as a job output. `compile` (now with no environment and no secrets)
    and `image_build` extract it with `ci/source_archive.py`, which checks the hash, needs
    an empty destination and uses the tarfile `data` filter. Builds get `APP_COMMIT`,
    `SOURCE_DATE_EPOCH` and `BUILD_OUTPUT_TIMESTAMP` instead of a `.git` directory.
13. **Repository writers could dispatch modified workflows.** Workflow YAML cannot prevent
    this, so the fix is in repository settings. `ci/audit_repo_settings.py` (run as an admin)
    fails when:
    - default workflow permissions are not read-only, or Actions may approve pull requests;
    - an environment is missing or can deploy from anything but `main`;
    - a reviewer environment lacks required reviewers or "Prevent self-review";
    - no active ruleset restricts creating branches and tags (`~ALL`).

    It lists the checks it cannot automate. SETUP.md and THREAT-MODEL.md explain why each
    setting is needed.

## Other

- `validate_publish_evidence.py` requires the attested config digest, and the signed build
  record includes it (`imageConfigDigest`).
- `examples/ci/build_and_test.sh` documents the variables a build gets when it has no `.git`.

---

# PoC changes, applied after v6 (2026-11-20)

Applied to the v6 kit for a first live run on a personal account; see the "PoC changes"
table in README.md for every file touched. When `allow_self_approval` is false, approval and
audit behave as in the kit. Additions: a bootstrap workflow for the first baseline.

## Review fixes (2026-11-21)

- `scripts/reproducible_build.sh`: builds on the current docker context's builder;
  `--builder default` is refused by buildx after `docker/setup-docker-action` switched the
  context, so no application image could be built on GitHub-hosted runners.
- `scripts/evaluate.py`: absolute findings (SUID/SGID, world-writable, watched symlinks,
  Critical/High/unknown) are review reasons when the candidate is the baseline itself; before,
  the first approval after a bootstrap examined nothing.
- `base-image-approval.yml`: every fingerprinted file triggers a base run; the evaluate summary
  shows the reasons.
- `examples/Dockerfile.application`: the jar is copied world-readable (`image_build` runs under
  `umask 077`).
- `ci/audit_repo_settings.py`: the switch comes from the audited repository's `main`.
- `ci/bootstrap_base.sh`: refuses before any write when a usable approval exists (with the
  consumers' age and version limits); upstream lookups fail with the tool's own error.
- `application-release.yml`: `authorize` reports a failed HEAD lookup as such.
