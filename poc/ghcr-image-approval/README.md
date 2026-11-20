# GHCR image approval: proof of concept

A live test of the uploaded kit `ghcr-image-approval-github-actions-v6-fixed` on GitHub
Actions and GHCR, in three new public repositories. Nothing in TaskFlow uses it. The folders
here are a hand-off: export each one into its own repository (step 2). They are not meant to
be merged into taskflow-enterprise.

| Folder | Repository | What it is |
| --- | --- | --- |
| `security-pipelines/` | `stefanf81/ghcr-approval-poc` | The kit with the minimum changes for a live run (its README lists them under "PoC changes") |
| `example-app/` | `stefanf81/ghcr-approval-poc-app` | Toy Java app the kit releases |
| `release-gate/` | `stefanf81/ghcr-approval-poc-gate` | Stand-in for the external release-authorization service the kit needs but does not supply |

Repository names are defaults. If you choose others, update `policy/applications.json`, the
`FROM` in `example-app/Dockerfile`, `release-gate/allowlist.json`, the default input in
`release-gate.yml` and the variables below. The names are also asserted in
`security-pipelines/tests/test_v3_fixes.py` and in both test files under `release-gate/tests/`;
change them there too or the test checks turn red.
All three must be **public**: on a free personal account, artifact attestations and environment
reviewers are only available for public repositories.

## What was verified before hand-off, and what was not

Verified in the session container:

- The kit's own suite (`ci/validate-local.sh` content) passes before and after the changes:
  231 tests, 5 skipped. The skipped ones need a Docker daemon with the containerd image store,
  or cosign.
- That includes 21 new tests, among them `ci/bootstrap_base.sh` run end to end against stub
  crane/cosign. Its record is then accepted as a comparison baseline, while the real precheck
  answers `needed` and `scripts/verify_bases.sh` refuses it for applications.
- Gate: grants produced by `serve_grants.sh` are accepted by the kit's
  `scripts/verify_release_authorization.py`. That script rejects them for another commit or
  when they are 11 minutes old. The gate's own 14 tests run the publishing loop against a
  local repository: it refuses and withdraws when the app's HEAD moves, retries a transient
  API error, and after a cancel signal or a withdrawal no loop is left that could publish
  again.
- The toy app's jar is byte-identical across two clean builds (normal and `CI_SKIP_TESTS=1`).
  Its Dockerfile passes the kit's `scripts/check_dockerfile_bases.py`.
- All workflows pass the kit's pinned actionlint 1.7.12. shellcheck was not installed, so
  `run:` scripts were not shellchecked.

Not verified here (no GHCR or GitHub access): everything below from step 4 on.

## 1. Before you start (on your machine)

- cosign v3 (for key generation and the final verification), openssl, git.
- The pinned Temurin digest
  `sha256:577acb7ab9893a6dfd6bcb138a25a4fb579ef1f3abcd197e24d9752e33457d85` was the
  `eclipse-temurin:21-jre-resolute` index on 2026-11-20. It may have moved by the time you run
  this, but that does not matter: the bootstrap imports exactly this pinned digest.

## 2. Create the repositories and push the folders

Create three **empty public** repositories with the names above: no README, no license. Then:

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

If git asks for credentials, the token needs the `workflow` scope, because the pushes contain
workflow files. `git subtree split` keeps file modes. This matters because `ci/build_and_test.sh` must stay
executable: the release pipeline runs it from a `git archive`.

**Expected:** pushing the security repository triggers `base-image-approval.yml`, which fails
in `precheck`. There is no baseline yet, and if you push before step 3 the variables are
missing too. This is harmless.

## 3. Configure

### Keys (locally; keep the private files out of every repository)

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
- Short expiry.

**Rulesets (optional for a green run; required for `ci/audit_repo_settings.py` to pass):**
- A branch ruleset and a tag ruleset, each targeting `~ALL`, with *Restrict creations*.
  Bypass: Repository admin.
- A branch ruleset on the default branch with:
  - *Require a pull request* with **0** approvals (the PoC switch allows 0);
  - *Require status checks*: `unit-tests`;
  - *Restrict deletions*;
  - an **empty** bypass list.

  From then on, kit changes go through pull requests.

Check all of this with the audit, from a checkout of the security repository (needs a token
with admin rights to it):

```bash
GH_TOKEN="$(gh auth token)" python3 ci/audit_repo_settings.py --repo stefanf81/ghcr-approval-poc
```

### `stefanf81/ghcr-approval-poc-gate`

- Workflow permissions read-only.
- Environment `release-gate` with deployment branch `main` and secret
  `GATE_PRIVATE_KEY_B64` (gate.key).

### `stefanf81/ghcr-approval-poc-app`

Nothing to configure. Its `ci.yml` runs on every push to `main`; the gate requires the `test`
check-run of that run.

## 4. First runs, in order

| # | Action | Expected result |
| --- | --- | --- |
| 1 | Security repo: run **GHCR - bootstrap first approved base (PoC)** with `confirm_digest` = `sha256:577acb7a…85` (full value from `catalog/Dockerfile.temurin`), then approve the `base-manual-approval` deployment | `approved/eclipse-temurin:21-jre-resolute` exists and is signed. The record carries `"bootstrap": true` and `approver: self:stefanf81` (in the `bootstrap-evidence` artifact). |
| 2 | Packages (your profile → Packages) | `approved/eclipse-temurin` is linked to the security repository. Make it **public**: two copies of a four-platform JRE count against the free private storage. |
| 3 | Run **GHCR - approve public base image** | `precheck`: `needed`. `quarantine` copies the index. `evaluate` returns **REVIEW**: the digest is compared with itself, so only the two "unverified upstream" reasons are expected. Approve `promote`; it signs a record with the current policy fingerprint. Make `quarantine/eclipse-temurin` public too. |
| 4 | Run it again | `precheck`: `approved`; every other job is skipped. |
| 5 | App repo: note the `main` HEAD SHA; its `test` check is green | |
| 6 | Gate repo: run **Release gate (PoC)** with that SHA, minutes `45` | The log shows "re-issued" every minute. `curl -s https://raw.githubusercontent.com/stefanf81/ghcr-approval-poc-gate/refs/heads/grants/<SHA>` returns JSON. Wait for that before step 7: a 404 fetched earlier can stay cached for 5 minutes. |
| 7 | Security repo: run **GHCR - protected application release** with `app_name=example-app` and `app_commit=<SHA>` | `authorize` → `compile` a/b → `image_build` a/b (attested) → `scan` → `push_candidate` → (`high_review` only on High findings: approve it) → `promote` → `independent_rescan` → `independent_verification` → `sign`. |
| 8 | Cancel the gate run | The grant is withdrawn (the `grants` branch holds only a README). A copy already cached by raw.githubusercontent.com can still be served for up to 5 minutes. |

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

**Verify the result** (with `app.pub`). The `applications/example-app` package is private
until you change it: either make it public first, or `docker login ghcr.io` with a classic
token that has `read:packages` (cosign uses the same Docker credentials):

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

## 5. Negative tests (no cluster needed)

| Test | Expected |
| --- | --- |
| Run any of the three security workflows from a branch other than `main` | Jobs skipped; environments refuse the branch |
| Release (step 7) after step 1 but before step 3 | `image_build` fails in `verify_bases.sh`: "signed policy content hash does not match" |
| Release with the gate not running | `authorize` fails (404 from the grant URL) |
| Revocation: add yourself as required reviewer to `ghcr-application-signing`, start a release, cancel the gate when `sign` is waiting, approve `sign` more than 10 minutes later | `sign` fails: 404 or "not freshly issued". Approving sooner can still succeed: a cached grant stays valid for up to 10 minutes after the cancel. Remove the reviewer afterwards |
| Release a commit that is not the app's `main` HEAD | Gate refuses; `authorize` fails "not the exact protected main HEAD" |
| `app_name` not in `policy/applications.json` | `authorize`: "APPLICATION NOT ALLOWED" |
| App change: add `RUN date > /stamp` to its Dockerfile **above** the `USER` line (below it the write is denied and the build simply fails), release the new HEAD | `scan` refuses: the two independent builders produce different layers |
| Run the bootstrap again | "already points at …" |
| Set `allow_self_approval` to `false` (this changes the fingerprint, so the push starts a new base run) | `promote`: "… started or reran this workflow and cannot approve" |
| Touch `scripts/evaluate.py` on `main`, rerun step 4 | `precheck`: `needed` (fingerprint changed) |
| Delete the secret `APP_COSIGN_KEY_B64` (GitHub does not store empty values), release, then restore it | `sign` fails closed; the image stays unsigned |
| Download artifact `image-a`, change one byte, `gh attestation verify` it against the security repo | Verification fails |

## 6. Known risks the live run has to settle

1. `scripts/reproducible_build.sh` builds with `--builder default`. Whether that reaches the
   daemon started by `docker/setup-docker-action` is unconfirmed. If not, `image_build` fails at
   `docker image inspect`.
2. cosign v3 bundles on GHCR: one signature plus several attestations on the same digest.
   Steps 1 and 3 already exercise this.
3. Package visibility and linking of nested names (`approved/eclipse-temurin`) created by
   `GITHUB_TOKEN`.
4. `actions/attest` v4 may also want `artifact-metadata: write`. The kit grants `id-token` and
   `attestations` only.
5. raw.githubusercontent.com cache age of the grant: compare the `age`/`x-cache` headers with
   the 10-minute limit.
6. The bare `compile` job relies on the runner image's Maven and default JDK 17.
7. Base approvals expire after 720 h (`approval_max_age_hours`) and nothing re-runs them on a
   schedule. After 30 days releases fail until step 3 is repeated.
8. The gate reads the app repository's check-runs with its own `GITHUB_TOKEN`. This works for
   public repositories.

## 7. Results log

| Date | Step / test | Run URL | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |

## 8. What this would mean for TaskFlow

Only after the toy run is green, and as a separate decision:

- **Backend:** possible only as a reduced release image, a separate `Dockerfile.release` built
  offline on an approved Temurin 25 base. It would have no tini, no build-time `apt-get
  upgrade`, no AOT cache (unlikely to be byte-identical across two builders) and no `useradd`.
  The jar would be the fat bootJar rather than the layered extract. The kit's single-base
  catalog would move to `25-jre-resolute`.
- **Frontend:** not feasible with the kit as is. Hashed bundle names cannot be listed as
  `build_outputs`, and nginx, brotli and the package refresh need `apk` with network.
- Today's `pushdockerimage.yml` and Dockerfiles would stay as they are until that decision.
