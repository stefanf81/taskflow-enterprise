# Runbook: base-image-gatekeeper

Setup, first runs and tests for `stefanf81/base-image-gatekeeper`. What the repository is and
how a base image moves through it is in [README.md](README.md).

The repository must be **public**: on a free personal account, artifact attestations and
environment reviewers are only available for public repositories.

The repository name is a default. To use another one, change, in one commit:
- `policy/applications.json` (`source_repo`);
- `release-gate/allowlist.json`;
- the default `repository` input in `.github/workflows/release-gate.yml`;
- `REPO`/`GATE_REPO` in both files under `release-gate/tests/`;
- `tests/test_v3_fixes.py`;
- the allowlist lookup in `base-gate/tests/test_base_gate.py`;
- the variables in step 3.

## What was verified before hand-off, and what was not

Verified in the session container (no GitHub, GHCR or Docker daemon available):

- **Kit suite:** 243 tests, 5 skipped (they need a Docker daemon with the containerd image
  store, or cosign). Among them are 33 PoC tests:
  - `ci/bootstrap_base.sh` runs end to end against stub crane/cosign that behave like GHCR (an
    empty package until the first copy; attestations accumulate). Its record is accepted as a
    comparison baseline, while the real precheck answers `needed` and `scripts/verify_bases.sh`
    refuses it for applications.
  - The bootstrap refuses before any write when the digest already carries a usable approval.
- **CI base-image gate:** 33 tests.
  - The planner runs against a real temporary git history: changed, added and removed pins;
    a Dockerfile dropped from the list is still watched; unpinned `FROM` fails.
  - `compare_all.sh` runs the kit's real `compare.sh` and `evaluate.py` against stub tools.
    A routine update passes. A new SUID file blocks even with an acceptance. A new base
    repository fails until accepted. Platform drift blocks.
  - The decision rules and the workflow wiring (`test` needs the gate) are tested too.
  - Mutation checks: accepting a block, ignoring an expiry, or ungating the build each make a
    test fail.
- **Release gate:** 19 tests run the publishing loop against a local repository:
  - it refuses and withdraws when `main` moves, and retries a transient API error;
  - the real workflow step stops on the runner's first signal;
  - a loop that survives a withdrawal cannot publish again (lease-protected pushes).
  - Its grants are accepted by the kit's `scripts/verify_release_authorization.py`, which
    rejects them for another commit or when they are more than 10 minutes old.
- **Single-repo build:** the pipeline's real `build` step ran twice on a `git archive` of this
  repository, as `application-release.yml` does. The jar was byte-identical (once normal, once
  `CI_SKIP_TESTS=1`), and `example-app/Dockerfile` passes `scripts/check_dockerfile_bases.py`.
- **buildx:** reproduced locally with buildx 0.39.0. `--builder default` fails once another
  context is current, which is what `docker/setup-docker-action` does. The PoC builds on the
  current context's builder.
- **Lint:** every workflow passes the kit's pinned actionlint 1.7.12 (with shellcheck 0.10.0),
  and `base-gate/compare_all.sh` passes shellcheck.

Not verified here: everything from step 2 on, including a gate run against real images.

## 1. Before you start (on your machine)

- **cosign v3:** key generation and the final verification.
- **openssl, git, curl.**
- **gh, logged in (`gh auth login`), and python3:** the settings audit and the attestation test.
- **docker:** the final `docker run`.
- **crane:** only for the gate tests in section 5 (finding another Temurin digest).
- **The pinned Temurin digest:**
  `sha256:577acb7ab9893a6dfd6bcb138a25a4fb579ef1f3abcd197e24d9752e33457d85` was the
  `eclipse-temurin:21-jre-resolute` index on 2026-11-20. It does not matter if the tag has
  moved since: the bootstrap imports exactly this pinned digest.

## 2. Create the repository and push

Create an **empty public** repository `stefanf81/base-image-gatekeeper`: no README, no
license. Push this tree to it as `main`:
- If Claude prepared it, it pushes the `standalone-poc` branch for you.
- Otherwise, from a clone that holds the tree on a branch: `git push
  https://github.com/stefanf81/base-image-gatekeeper.git <branch>:main`.

If git asks for credentials, the token needs the `workflow` scope (the push contains workflow
files). Keep file modes: `example-app/ci/build_and_test.sh` must stay executable, because the
release pipeline runs it from a `git archive`.

**Expected on the first push:**
- `base-image-approval.yml` fails in `precheck`: no baseline yet, and no variables until step 3.
  This is harmless.
- **Example app tests**: `base-image-gate` skips ("no previous commit"), then `test` builds
  the app.

## 3. Configure

### Keys

Generate them in a directory of their own, outside every repository, and keep it until the PoC
ends:

```bash
mkdir -p ~/ghcr-poc-keys && cd ~/ghcr-poc-keys && umask 077
```

```bash
COSIGN_PASSWORD='<approval-password>' cosign generate-key-pair --output-key-prefix approval
```

```bash
COSIGN_PASSWORD='<app-password>' cosign generate-key-pair --output-key-prefix app
```

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out verifier.key && openssl pkey -in verifier.key -pubout -out verifier.pub
```

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out gate.key && openssl pkey -in gate.key -pubout -out gate.pub
```

Each `*_B64` secret below is `base64 -w0 <file>` (on macOS: `base64 -i <file>`).

### Settings → Actions → General

- Workflow permissions: **Read repository contents and packages permissions**. Every job asks
  for more itself.
- Leave "Allow GitHub Actions to create and approve pull requests" **off**.

### Variables

| Name | Value |
| --- | --- |
| `GHCR_NAMESPACE` | `stefanf81` |
| `RELEASE_GATE_URL` | `https://raw.githubusercontent.com/stefanf81/base-image-gatekeeper/refs/heads/grants` |
| `RELEASE_GATE_ISSUER` | `base-image-gatekeeper-release-gate` |
| `RELEASE_GATE_SCHEMA` | `https://example.org/verified-release/v1` |
| `RELEASE_REQUIRED_CHECKS` | `tests` |

### Repository secrets (public keys only)

- `APPROVAL_PUBKEY_B64`: `approval.pub`
- `RELEASE_GATE_PUBKEY_B64`: `gate.pub`

### Environments

Create all eleven. Each one gets *Deployment branches and tags → Selected branches → `main`*.
Do not use "Protected branches only": the audit refuses it.

| Environment | Required reviewer | Secrets |
| --- | --- | --- |
| `base-manual-approval` | you; *Prevent self-review* **off** | `APPROVAL_PRIVATE_KEY_B64` (approval.key), `COSIGN_PASSWORD` (approval password) |
| `application-high-cve-review` | you; *Prevent self-review* **off** | none |
| `independent-verification` | none | `VERIFIER_PRIVATE_KEY_B64` (verifier.key) |
| `ghcr-application-signing` | none | `APP_COSIGN_KEY_B64` (app.key), `APP_COSIGN_PUBKEY_B64` (app.pub), `COSIGN_PASSWORD` (app password), `VERIFIER_PUBLIC_KEY_B64` (verifier.pub) |
| `release-gate` | none (add yourself if each grant should need a click) | `GATE_PRIVATE_KEY_B64` (gate.key) |
| `application-source-read` | none | none needed (see below) |
| `base-auto-promotion` | none | **none**: unreachable while upstream provenance is unverified; without a key it fails closed |
| `ghcr-quarantine`, `ghcr-read-only`, `ghcr-candidate-writer`, `ghcr-application-promoter` | none | none |

**`APPLICATION_READ_TOKEN` is optional.** The app is in this repository, so `authorize` reads
it with the job's own `GITHUB_TOKEN`. Set the secret in `application-source-read` only if the
app ever moves to another (private) repository. It is a fine-grained token, Contents
read-only, for that repository only.

### The `grants` branch

The release gate publishes grants on an orphan branch `grants`. If you add the "Restrict
creations" ruleset below, create the branch once by hand first, or the gate's first push is
refused. Any content works, because the gate replaces it:

```bash
gh api -X POST repos/stefanf81/base-image-gatekeeper/git/refs -f ref=refs/heads/grants -f sha="$(gh api repos/stefanf81/base-image-gatekeeper/commits/main --jq .sha)"
```

### Rulesets

These are optional for a green run, but required for `ci/audit_repo_settings.py` to pass.
- **Creations:** a branch ruleset and a tag ruleset, each targeting `~ALL`, with *Restrict
  creations*. Bypass: Repository admin.
- **Default branch:** a branch ruleset with:
  - *Require a pull request* with **0** approvals (the PoC switch allows 0);
  - *Require status checks*: `unit-tests`, `base-image-gate` and `test`;
  - *Restrict deletions*;
  - an **empty** bypass list.

  From then on, every change goes through a pull request, and a pull request that moves a base
  image without passing the gate cannot be merged.

Check all of this with the audit, from a clone (needs a token with admin rights to the
repository). It reads `allow_self_approval` from `policy/config.json` on `main`, not from your
clone:

```bash
GH_TOKEN="$(gh auth token)" python3 ci/audit_repo_settings.py --repo stefanf81/base-image-gatekeeper
```

## 4. First runs, in order

| # | Action | Expected result |
| --- | --- | --- |
| 1 | Run **GHCR - bootstrap first approved base (PoC)** with `confirm_digest` = `sha256:577acb7a…85` (full value from `catalog/Dockerfile.temurin`), then approve the `base-manual-approval` deployment | `approved/eclipse-temurin:21-jre-resolute` exists and is signed. The record carries `"bootstrap": true` and `approver: self:stefanf81` (in the `bootstrap-evidence` artifact). |
| 2 | Packages (your profile → Packages) | `approved/eclipse-temurin` is linked to this repository. Make it **public**: two copies of a four-platform JRE count against the free private storage. |
| 3 | Run **GHCR - approve public base image** | See the walkthrough below the table. |
| 4 | Run it again | `precheck`: `approved`; every other job is skipped. |
| 5 | Note the `main` HEAD SHA | Its **Example app tests** run on `main` is green: `base-image-gate`, then `test`. |
| 6 | Run **Release gate (PoC)** with that SHA (`repository` defaults to this one), minutes `90` (the default) | The log shows "re-issued" every minute. Wait for that line before you curl, and before step 7: a 404 fetched too early can stay cached for 5 minutes. Then `curl -s https://raw.githubusercontent.com/stefanf81/base-image-gatekeeper/refs/heads/grants/<SHA>` returns JSON. If the CI run is still running (or is re-run later), the log says "not finished: no new grant this round" and the gate waits. It only gives up on a failed run or a new `main` HEAD. |
| 7 | Run **GHCR - protected application release** with `app_name=example-app` and `app_commit=<SHA>`. **Merge nothing until it has signed**: a new `main` HEAD makes the gate withdraw | `authorize` → `compile` a/b → `image_build` a/b (attested) → `scan` → `push_candidate` → (`high_review` only on High findings: approve it) → `promote` → `independent_rescan` → `independent_verification` → `sign`. |
| 8 | Cancel the gate run | The grant is withdrawn (the `grants` branch holds only a README). A copy already cached by raw.githubusercontent.com can still be served for up to 5 minutes. |

**Step 3 walkthrough:**
- `precheck` answers `needed` and `quarantine` copies the index.
- `evaluate` returns **REVIEW**. The digest is compared with itself, so no diff check can find
  anything, and the run lists the image's **absolute** findings instead. The `evaluate` job
  summary shows every reason:
  - the two routine ones ("No verified upstream publisher signature", "No independently
    validated upstream build provenance");
  - "Candidate is the approved baseline itself …";
  - per platform, "absolute review" lines for SUID/SGID files, world-writable files and
    directories, symlinks into watched locations, and Critical/High/unknown vulnerabilities.
- Read them before you approve `promote`. Expect, for a stock Temurin/Ubuntu image:
  - the usual setuid tools (`su`, `passwd`, `mount`, …);
  - world-writable only for sticky temp directories (`tmp`, `var/tmp`, `run/lock`);
  - among the symlinks into watched locations, `var/lock` (pointing to `/run/lock`);
  - no Critical vulnerabilities.

  Anything else needs a reason before you approve. The full lists are in `decision.json` of
  the `base-evidence` artifact.
- Once approved, `promote` signs a record with the current policy fingerprint.
- Make `quarantine/eclipse-temurin` public too.

**If `scan` ends in BLOCK** (a Critical or unrated finding in the Ubuntu base), add an
exception to `critical_exceptions` in `policy/config.json` via a pull request. Scope it to the
approved **base**:

```json
{"id": "CVE-…", "package": "…", "package_version": "…", "platform": "linux/amd64",
 "expires": "2026-12-31", "reason": "PoC: …", "approved_by": "stefanf81",
 "base_image_ref": "ghcr.io/stefanf81/approved/eclipse-temurin@sha256:577acb7a…"}
```

- **Not `image_ref`:** in a single repository, the merge of that pull request is a new commit.
  Its jar carries a new commit timestamp, so the image digest named by `image_ref` never comes
  back.
- **`base_image_ref`:** it covers every commit of the app built on that base, because the app
  image only adds files on top of it.
- **Fingerprint:** neither form changes the base policy fingerprint, so the base approval
  stays valid.
- **Then:** release the merge commit (steps 5–7).

**Verify the result** (from `~/ghcr-poc-keys`, which holds `app.pub`). The
`applications/example-app` package is private until you change it: either make it public
first, or `docker login ghcr.io` with a classic token that has `read:packages` (cosign uses the
same Docker credentials):

```bash
IMAGE=ghcr.io/stefanf81/applications/example-app@sha256:<digest from the sign job summary>
```

```bash
cosign verify --insecure-ignore-tlog=true --key app.pub "$IMAGE"
```

```bash
cosign verify-attestation --insecure-ignore-tlog=true --key app.pub --type cyclonedx "$IMAGE" > /dev/null && echo SBOM ok
```

```bash
cosign verify-attestation --insecure-ignore-tlog=true --key app.pub --type https://example.org/github-actions-build-record/v1 "$IMAGE" > /dev/null && echo build record ok
```

```bash
docker run --rm "$IMAGE"
```

The last command prints `example-app: released through the signed GHCR pipeline`.

## 5. Tests (no cluster needed)

The **read-only tests** change nothing and can run in any order once section 4 is done.

The **pull-request tests** exercise the CI base-image gate. Close each pull request unmerged
when you are done; nothing changes on `main`.

The **state-changing tests** change a setting or `main`. Run them one at a time, and finish
each one's undo step before the next, or later tests fail for unrelated reasons.

### Read-only tests

| Test | Expected |
| --- | --- |
| Dispatch the bootstrap, the base approval or the application release from a branch other than `main` | Every job is skipped (`if: github.ref == 'refs/heads/main'`) |
| Release with the gate not running | `authorize` fails: curl 404 from the grant URL |
| Release with an `app_name` that is not in `policy/applications.json` | `authorize`: "APPLICATION NOT ALLOWED" |
| Run the bootstrap again | "… already points at sha256:…; use base-image-approval.yml" |
| Download the `image-a` artifact of a release run, change one byte of `application-image.tar`, run `gh attestation verify application-image.tar --repo stefanf81/base-image-gatekeeper` | Verification fails |

### Pull-request tests (CI base-image gate)

Find another Temurin digest with `crane digest eclipse-temurin:21-jre-noble` (Ubuntu 24.04
instead of 26.04). The repository is the same, so the gate compares the two digests.

| Pull request | Expected in **Example app tests** |
| --- | --- |
| Change only the README | `base-image-gate`: "No base-image pin changed" (seconds); `test` runs |
| In `catalog/Dockerfile.temurin`, replace the digest (and, for readability, the tag) with the `noble` one | `base-image-gate` **fails** after the scan. The summary lists ATTENTION reasons (packages added/removed or downgraded, files in watched locations, probably new High CVEs) and any BLOCK. `test` is skipped. The `base-image-gate-evidence` artifact holds the reports. |
| Same pull request plus an acceptance in `base-gate/config.json` for `docker.io/library/eclipse-temurin@<noble digest>` (expires within 90 days) | If the first run had no BLOCK: `ACCEPTED`, and `test` runs. A BLOCK still fails. |
| In `example-app/Dockerfile`, add `FROM docker.io/library/alpine@<digest> AS tools` above the existing `FROM` (`crane digest alpine:3.22`) | `base-image-gate` fails: "added pin … compared with itself". The summary has "Candidate is the approved baseline itself …" and the image's absolute findings. Accepting it would pass this gate, but the release would still refuse a base that is not approved. |
| Remove `catalog/Dockerfile.temurin` from `dockerfiles` in `base-gate/config.json` and change its digest | The gate still compares it: files listed on `main` stay watched. |

### State-changing tests

| Test | Expected | Undo |
| --- | --- | --- |
| **Revocation.** Add yourself as required reviewer of `ghcr-application-signing`. Start a release with the gate running. When `sign` waits for approval, cancel the gate. Approve `sign` more than 10 minutes after the cancel and less than 30 minutes after `independent_verification` finished (about 12–15 minutes after the cancel works). | `sign` fails: curl 404, or "release authorization is not freshly issued". Approving later than 30 minutes fails earlier, on the expired verification record ("independent scan attestation expired"), and does not test revocation. | Remove the reviewer. |
| **Merge during a release.** Start the gate and a release for the HEAD, then merge a README-only pull request. | The gate logs "… is not the main HEAD …", withdraws and ends; the release fails at its next grant fetch (`sign` at the latest). | None; release the new HEAD if you need a green release. |
| **Non-reproducible build.** In `example-app/Dockerfile`, add `RUN cat /proc/sys/kernel/random/uuid > /stamp` above the `USER` line (below it, the write is denied). Merge, grant and release the new HEAD. | `scan` refuses: "Independent builder archives have different verified layer sequences" | Revert via pull request. |
| **Self-approval off.** Pull request that sets `allow_self_approval` to `false`; merge it. | The merge changes the base fingerprint and starts a base run: `precheck` says `needed`. Approve its `promote` deployment: the job then refuses you ("… started or reran this workflow and cannot approve 'base-manual-approval'") and fails. Meanwhile releases fail in `image_build` ("signed policy content hash does not match"). | Pull request back to `true`. The fingerprint is the approved one again, and the merge's base run stops at `precheck`: `approved`. |
| **Fingerprint change.** Pull request that adds a comment line to `scripts/evaluate.py`; merge it. | The merge starts a base run: `precheck` says `needed`, and `evaluate` reviews the digest against itself again. | Approve its `promote` (a new record with the new fingerprint), or cancel the run and revert. Releases fail until one of the two is done. |
| **Stale commit.** Merge a README-only pull request, then grant and release the **previous** SHA. | The gate refuses ("… is not the main HEAD …"); a release fails in `authorize` with "Requested commit is not the exact protected main HEAD (… main is <new SHA>)". | None, but later tests must use the **new** HEAD (wait for its CI run to go green). |
| **Deleted signing key.** Delete the secret `APP_COSIGN_KEY_B64` (GitHub stores no empty values). Grant and release. | `sign` fails closed at `cosign sign`; the promoted image stays unsigned. | Restore the secret. |

## 6. Single-repository trade-offs

- **Separation of duties is weaker.** Pipeline, app and release gate share one repository and
  one set of maintainers, so whoever can change `main` can change all three. The kit intends
  separate repositories or services; this PoC keeps them together for simplicity.
- **Pull requests run their own workflow files.** A `pull_request` run uses the PR's version of
  `example-app-ci.yml` and `base-gate/`, so a PR could weaken the gate it is checked by. Review
  changes to `.github/workflows/`, `base-gate/`, `scripts/` and `policy/`. Once there is a
  second maintainer, use CODEOWNERS and required approvals.
- **No merges during a release.** Any merge moves `main`; the release gate then withdraws.
- **Exceptions by base, not by image:** see "If `scan` ends in BLOCK" above.
- **Acceptances outlive the pull request.** The push run after the merge compares the same pins
  again, so keep an acceptance until the release has passed; delete it once it has expired.

## 7. Known risks the live run has to settle

1. **cosign v3 bundles on GHCR:** one signature plus several attestations on the same digest.
   Steps 1 and 3 exercise this.
2. **Package visibility and linking** of nested names (`approved/eclipse-temurin`) created by
   `GITHUB_TOKEN`.
3. **`actions/attest` v4** may also want `artifact-metadata: write`. The kit grants `id-token`
   and `attestations` only.
4. **Grant cache age:** compare raw.githubusercontent.com's `age`/`x-cache` headers on the
   grant with the 10-minute limit.
5. **Compile toolchain:** the bare `compile` job relies on the runner image's Maven and default
   JDK 17.
6. **Approval expiry:** base approvals expire after 720 h (`approval_max_age_hours`), and
   nothing re-runs them on a schedule. After 30 days, releases fail until step 3 is repeated.
7. **CI gate pulls:** the gate reads Docker Hub anonymously, and a rate-limited pull fails the
   gate (fail closed: re-run the job). It reads GHCR with the job's `packages: read` token,
   which needs the approved package to be linked to this repository (step 2 of section 4).
8. **CI gate duration:** a moved pin is scanned on every platform of the index (four for
   Temurin), twice per image. Expect tens of minutes; the job's limit is 120.

Fixed after review, still worth watching:
- **Image build:** it now runs on the current Docker context's builder instead of
  `--builder default`.
- **Jar mode:** the app's jar is copied with `--chmod=0444`.

## 8. Recovery: the approved baseline can no longer be verified

This happens after rotating or losing the approval key, or when the baseline is older than 365
days (`historical_baseline_max_age_hours`):
- base runs fail in `evaluate` at `cosign verify`, or report the record as too old;
- the bootstrap refuses because the tracking tag exists;
- releases stop once the current approval passes 720 h.

To recover:

1. Your profile → Packages → `approved/eclipse-temurin` → Package settings → **Delete this
   package**. Its signatures and attestations are stored in the same package and go with it.
2. Run step 1 (bootstrap) again with the current catalog pin, then steps 3 and 4.

If only the tracking tag is missing and the digest still carries a current approval, do not
delete anything. The bootstrap refuses and prints the `crane tag …` command that restores the
tag.

## 9. Results log

| Date | Step / test | Run URL | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
