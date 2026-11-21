# GHCR image approval: proof of concept

A live test of the uploaded kit `ghcr-image-approval-github-actions-v6-fixed` on GitHub
Actions and GHCR, in three new public repositories. Nothing in TaskFlow uses it. The folders
here are a hand-off: export each one into its own repository (step 2). They are not meant to
be merged into taskflow-enterprise.

| Folder | Repository | What it is |
| --- | --- | --- |
| `security-pipelines/` | `stefanf81/ghcr-approval-poc` | The kit with the changes a live run needs (its README lists them under "PoC changes") |
| `example-app/` | `stefanf81/ghcr-approval-poc-app` | Toy Java app the kit releases |
| `release-gate/` | `stefanf81/ghcr-approval-poc-gate` | Stand-in for the external release-authorization service the kit needs but does not supply |

All three must be **public**: on a free personal account, artifact attestations and environment
reviewers are only available for public repositories.

Repository names are defaults. To use others, push first (step 2), then edit and commit **in
the new repositories**, never in the export clone. Change `policy/applications.json` and
`tests/test_v3_fixes.py` in the security repository, the `FROM` in the app's `Dockerfile`,
`allowlist.json`, the default input in `.github/workflows/release-gate.yml` and both files
under `tests/` in the gate repository, and the variables in step 3.

## What was verified before hand-off, and what was not

Verified in the session container (no GitHub, GHCR or Docker daemon available):

- **Kit suite:** `ci/validate-local.sh` passes: 243 tests, 5 skipped. The skipped ones need a
  Docker daemon with the containerd image store, or cosign. It includes 33 PoC tests:
  - `ci/bootstrap_base.sh` runs end to end against stub crane/cosign that behave like GHCR (an
    empty package until the first copy; attestations accumulate). Its record is accepted as a
    comparison baseline, while the real precheck answers `needed` and `scripts/verify_bases.sh`
    refuses it for applications.
  - It refuses before any write when the digest already carries a usable approval.
- **Gate:** 16 tests run the publishing loop against a local repository:
  - it refuses and withdraws when the app's HEAD moves, and retries a transient API error;
  - the real workflow step stops on the runner's first signal;
  - a loop that survives a withdrawal cannot publish again (lease-protected pushes).
  - Its grants are accepted by the kit's `scripts/verify_release_authorization.py`, which
    rejects them for another commit or when they are more than 10 minutes old.
- **Mutation checks:** undoing any of the review fixes, one at a time, makes its test fail
  (10 kit checks, 5 gate checks).
- **buildx:** reproduced locally with buildx 0.39.0. `--builder default` fails ("use `docker
  --context=default buildx` …") once another context is current, which is what
  `docker/setup-docker-action` does. The PoC now builds on the current context's builder.
- **Toy app:**
  - the jar is byte-identical across two clean builds (normal and `CI_SKIP_TESTS=1`);
  - its Dockerfile passes the kit's `scripts/check_dockerfile_bases.py`;
  - the jar is copied with `--chmod=0444`; this was not run (no daemon), so the final
    `docker run` in step 7 is its check.
- **Lint:** all workflows pass the kit's pinned actionlint 1.7.12.

Not verified here: everything from step 4 on.

## 1. Before you start (on your machine)

- **cosign v3:** key generation and the final verification.
- **openssl, git.**
- **gh, logged in (`gh auth login`), and python3:** the settings audit and the attestation test.
- **curl:** checking the grant URL.
- **docker:** the final `docker run`.
- **The pinned Temurin digest:**
  `sha256:577acb7ab9893a6dfd6bcb138a25a4fb579ef1f3abcd197e24d9752e33457d85` was the
  `eclipse-temurin:21-jre-resolute` index on 2026-11-20. It does not matter if the tag has
  moved since: the bootstrap imports exactly this pinned digest.

## 2. Create the repositories and push the folders

Create three **empty public** repositories with the names above: no README, no license. Then,
in a scratch directory:

```bash
git clone --branch claude/nice-knuth-o684a3 https://github.com/stefanf81/taskflow-enterprise.git poc-export
```

```bash
cd poc-export
```

```bash
for pair in security-pipelines:ghcr-approval-poc example-app:ghcr-approval-poc-app release-gate:ghcr-approval-poc-gate; do
  folder="${pair%%:*}"; repo="${pair##*:}"
  git subtree split --prefix="poc/ghcr-image-approval/$folder" -b "export-$folder"
  git push "https://github.com/stefanf81/$repo.git" "export-$folder:main"
done
```

```bash
cd .. && rm -rf poc-export
```

- **Credentials:** if git asks for them, the token needs the `workflow` scope, because the
  pushes contain workflow files.
- **File modes:** `git subtree split` keeps them. That matters because
  `ci/build_and_test.sh` must stay executable; the release pipeline runs it from a
  `git archive`.

**Expected:** pushing the security repository triggers `base-image-approval.yml`, which fails
in `precheck`. There is no baseline yet, and if you push before step 3 the variables are
missing too. This is harmless.

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

### `stefanf81/ghcr-approval-poc` (security repository)

**Settings → Actions → General:**
- Workflow permissions: **Read repository contents and packages permissions**.
- Leave "Allow GitHub Actions to create and approve pull requests" **off**.

**Variables:**

| Name | Value |
| --- | --- |
| `GHCR_NAMESPACE` | `stefanf81` |
| `RELEASE_GATE_URL` | `https://raw.githubusercontent.com/stefanf81/ghcr-approval-poc-gate/refs/heads/grants` |
| `RELEASE_GATE_ISSUER` | `stefanf81-poc-release-gate` |
| `RELEASE_GATE_SCHEMA` | `https://example.org/verified-release/v1` |
| `RELEASE_REQUIRED_CHECKS` | `tests` |

**Repository secrets** (public keys only):
- `APPROVAL_PUBKEY_B64`: `approval.pub`
- `RELEASE_GATE_PUBKEY_B64`: `gate.pub`

**Environments.** Create all ten. Each one gets *Deployment branches and tags → Selected
branches → `main`*. Do not use "Protected branches only": the audit refuses it.

| Environment | Required reviewer | Secrets |
| --- | --- | --- |
| `base-manual-approval` | you; *Prevent self-review* **off** | `APPROVAL_PRIVATE_KEY_B64` (approval.key), `COSIGN_PASSWORD` (approval password) |
| `application-high-cve-review` | you; *Prevent self-review* **off** | none |
| `application-source-read` | none | `APPLICATION_READ_TOKEN` |
| `independent-verification` | none | `VERIFIER_PRIVATE_KEY_B64` (verifier.key) |
| `ghcr-application-signing` | none | `APP_COSIGN_KEY_B64` (app.key), `APP_COSIGN_PUBKEY_B64` (app.pub), `COSIGN_PASSWORD` (app password), `VERIFIER_PUBLIC_KEY_B64` (verifier.pub) |
| `base-auto-promotion` | none | **none**: unreachable while upstream provenance is unverified; without a key it fails closed |
| `ghcr-quarantine`, `ghcr-read-only`, `ghcr-candidate-writer`, `ghcr-application-promoter` | none | none |

**`APPLICATION_READ_TOKEN`:** a fine-grained personal access token. It is needed even though
the app repository is public, because the `authorize` job always uses it.
- Resource owner: you.
- Repository access: only `ghcr-approval-poc-app`.
- Permissions: Contents **read-only**.
- Short expiry. When it expires, `authorize` fails with gh's own error (`HTTP 401`).

**Rulesets (optional for a green run; required for `ci/audit_repo_settings.py` to pass):**
- A branch ruleset and a tag ruleset, each targeting `~ALL`, with *Restrict creations*.
  Bypass: Repository admin.
- A branch ruleset on the default branch with:
  - *Require a pull request* with **0** approvals (the PoC switch allows 0);
  - *Require status checks*: `unit-tests`;
  - *Restrict deletions*;
  - an **empty** bypass list.

  From then on, kit changes go through pull requests.

Check all of this with the audit, from a clone of the security repository (needs a token with
admin rights to it). It reads `allow_self_approval` from `policy/config.json` on the
repository's `main`, not from your clone:

```bash
GH_TOKEN="$(gh auth token)" python3 ci/audit_repo_settings.py --repo stefanf81/ghcr-approval-poc
```

### `stefanf81/ghcr-approval-poc-gate`

- Workflow permissions read-only.
- Environment `release-gate` with deployment branch `main` and secret
  `GATE_PRIVATE_KEY_B64` (gate.key).

### `stefanf81/ghcr-approval-poc-app`

Nothing to configure. Its `ci.yml` ("Application tests (no publishing secrets)") runs on every
push to `main`. The gate requires the newest push run of exactly that workflow file for the
commit to have succeeded.

## 4. First runs, in order

| # | Action | Expected result |
| --- | --- | --- |
| 1 | Security repo: run **GHCR - bootstrap first approved base (PoC)** with `confirm_digest` = `sha256:577acb7a…85` (full value from `catalog/Dockerfile.temurin`), then approve the `base-manual-approval` deployment | `approved/eclipse-temurin:21-jre-resolute` exists and is signed. The record carries `"bootstrap": true` and `approver: self:stefanf81` (in the `bootstrap-evidence` artifact). |
| 2 | Packages (your profile → Packages) | `approved/eclipse-temurin` is linked to the security repository. Make it **public**: two copies of a four-platform JRE count against the free private storage. |
| 3 | Run **GHCR - approve public base image** | See the walkthrough below the table. |
| 4 | Run it again | `precheck`: `approved`; every other job is skipped. |
| 5 | App repo: note the `main` HEAD SHA | Its **Application tests (no publishing secrets)** run on `main` is green. |
| 6 | Gate repo: run **Release gate (PoC)** with that SHA, minutes `90` (the default) | The log shows "re-issued" every minute. `curl -s https://raw.githubusercontent.com/stefanf81/ghcr-approval-poc-gate/refs/heads/grants/<SHA>` returns JSON. Wait for that line in the log before you curl, and before step 7: a 404 fetched too early can stay cached for 5 minutes. |
| 7 | Security repo: run **GHCR - protected application release** with `app_name=example-app` and `app_commit=<SHA>` | `authorize` → `compile` a/b → `image_build` a/b (attested) → `scan` → `push_candidate` → (`high_review` only on High findings: approve it) → `promote` → `independent_rescan` → `independent_verification` → `sign`. |
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
  - world-writable only for sticky temp directories (`tmp`, `var/tmp`);
  - no Critical vulnerabilities.

  Anything else needs a reason before you approve. The full lists are in `decision.json` of
  the `base-evidence` artifact.
- Once approved, `promote` signs a record with the current policy fingerprint.
- Make `quarantine/eclipse-temurin` public too.

**If `scan` ends in BLOCK** (a Critical or unrated finding in the Ubuntu base): the job summary
prints the "Release digest". Add an exception scoped to that exact image to
`critical_exceptions` in `policy/config.json` (via a pull request), then dispatch the same
commit again, with the gate running again for it (step 6). The build is reproducible, so the
digest is identical:

```json
{"id": "CVE-…", "package": "…", "package_version": "…", "platform": "linux/amd64",
 "expires": "2026-12-31", "reason": "PoC: …", "approved_by": "stefanf81",
 "image_ref": "ghcr.io/stefanf81/applications/example-app@sha256:…"}
```

Instead of `image_ref` you can scope the exception to the approved base with
`"base_image_ref": "ghcr.io/stefanf81/approved/eclipse-temurin@sha256:577acb7a…"`. It then
also covers later commits of the toy app, because its image only adds files on top of the
base. Neither form changes the base policy fingerprint, so the base approval stays valid.

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

The last command prints `ghcr-approval-poc-app: released through the signed GHCR pipeline`.

## 5. Negative tests (no cluster needed)

The **read-only tests** change nothing and can run in any order once section 4 is done.

The **state-changing tests** change a setting or the repository. Run them one at a time, and
finish each one's undo step before the next, or later tests fail for unrelated reasons.

### Read-only tests

| Test | Expected |
| --- | --- |
| Dispatch the bootstrap, the base approval or the application release from a branch other than `main` | Every job is skipped (`if: github.ref == 'refs/heads/main'`) |
| Release with the gate not running | `authorize` fails: curl 404 from the grant URL |
| Push a new commit to the app, then grant and release the **previous** SHA | The gate refuses ("… is not the main HEAD …") and withdraws; a release fails in `authorize` with "Requested commit is not the exact protected main HEAD (… main is <new SHA>)" |
| Release with an `app_name` that is not in `policy/applications.json` | `authorize`: "APPLICATION NOT ALLOWED" |
| Run the bootstrap again | "… already points at sha256:…; use base-image-approval.yml" |
| Download the `image-a` artifact of a release run, change one byte of `application-image.tar`, run `gh attestation verify application-image.tar --repo stefanf81/ghcr-approval-poc` | Verification fails |

### State-changing tests

| Test | Expected | Undo |
| --- | --- | --- |
| **Revocation.** Add yourself as required reviewer of `ghcr-application-signing`. Start a release with the gate running. When `sign` waits for approval, cancel the gate. Approve `sign` more than 10 minutes after the cancel and less than 30 minutes after `independent_verification` finished (about 12–15 minutes after the cancel works). | `sign` fails: curl 404, or "release authorization is not freshly issued". Approving later than 30 minutes fails earlier, on the expired verification record ("independent scan attestation expired"), and does not test revocation. | Remove the reviewer. |
| **Non-reproducible build.** In the app's `Dockerfile`, add `RUN cat /proc/sys/kernel/random/uuid > /stamp` above the `USER` line (below it, the write is denied). Push, grant and release the new HEAD. | `scan` refuses: "Independent builder archives have different verified layer sequences" | Revert the commit. The revert is a new HEAD; grant and release that one if you need a green release. |
| **Self-approval off.** PR that sets `allow_self_approval` to `false`; merge it. | The merge changes the base fingerprint and starts a base run: `precheck` says `needed`. Approve its `promote` deployment: the job then refuses you ("… started or reran this workflow and cannot approve 'base-manual-approval'") and fails. Meanwhile releases fail in `image_build` ("signed policy content hash does not match"). | PR back to `true`. The fingerprint is the approved one again, and the merge's base run stops at `precheck`: `approved`. |
| **Fingerprint change.** PR that adds a comment line to `scripts/evaluate.py`; merge it. | The merge starts a base run: `precheck` says `needed`, and `evaluate` reviews the digest against itself again. | Approve its `promote` (a new record with the new fingerprint), or cancel the run and revert the PR. Releases fail until one of the two is done. |
| **Deleted signing key.** Delete the secret `APP_COSIGN_KEY_B64` (GitHub stores no empty values). Grant and release. | `sign` fails closed at `cosign sign`; the promoted image stays unsigned. | Restore the secret. |

## 6. Known risks the live run has to settle

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
7. **Gate API access:** the gate reads the app repository's workflow runs with its own
   `GITHUB_TOKEN`. That should work because the repository is public.

Fixed after review, still worth watching:
- **Image build:** it now runs on the current Docker context's builder instead of
  `--builder default`.
- **Jar mode:** the app's jar is copied with `--chmod=0444`.

## 7. Recovery: the approved baseline can no longer be verified

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

## 8. Results log

| Date | Step / test | Run URL | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |

## 9. What this would mean for TaskFlow

Only after the toy run is green, and as a separate decision:

- **Backend:** possible only as a reduced release image, a separate `Dockerfile.release` built
  offline on an approved Temurin 25 base. It would have no tini, no build-time `apt-get
  upgrade`, no AOT cache (unlikely to be byte-identical across two builders) and no `useradd`.
  The jar would be the fat bootJar rather than the layered extract, copied with `--chmod`. The
  kit's single-base catalog would move to `25-jre-resolute`.
- **Frontend:** not feasible with the kit as is. Hashed bundle names cannot be listed as
  `build_outputs`, and nginx, brotli and the package refresh need `apk` with network.
- Today's `pushdockerimage.yml` and Dockerfiles would stay as they are until that decision.
