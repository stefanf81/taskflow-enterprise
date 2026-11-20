# GHCR + GitHub Actions staging setup (v6)

## 1. Registry organization

Configure repository variable `GHCR_NAMESPACE` to the **lowercase** organization/user that owns the GHCR packages, for example `acme`. The registry hostname is always `ghcr.io`; do not set `GHCR_HOST` to include the owner. Example image references:

```text
ghcr.io/acme/quarantine/eclipse-temurin@sha256:<digest>
ghcr.io/acme/approved/eclipse-temurin@sha256:<digest>
ghcr.io/acme/application-candidates/myapp@sha256:<digest>
ghcr.io/acme/applications/myapp@sha256:<digest>
```

Each path is a *separate GHCR container package*. Paths are NOT isolation policies. Keep application names lowercase and OCI-compatible; create and configure packages explicitly before production rollout. Promote by **digest**, not by assuming a mutable tag is trustworthy.

## 2. GitHub package permissions

GitHub Actions authenticates with the per-job `GITHUB_TOKEN` (`username: github.actor`, `password: github.token`). The workflow permissions are intentionally different:

| Job | `packages` permission | Capability |
|---|---|---|
| Base precheck | `read` | Skip a digest that is already approved under an accepted policy version |
| Base quarantine | `write` | Copy the pinned upstream digest into quarantine; parses nothing |
| Base evaluation | `read` | diffoci/Syft/Grype/inventory of the untrusted image |
| Base promotion | `write` | Copy candidate to approved, sign and publish tracking tag |
| Application authorize | none | Only holder of `APPLICATION_READ_TOKEN`; makes the hash-pinned source archive |
| Application compilation | none | Untrusted source build, no GHCR token, no environment secrets |
| Independent image builders | `read` | Fetch approved bases, verify Cosign, attest outputs |
| Scan | `read` | Verify attestations, layer analysis, Syft/Grype of the saved archive |
| Push candidate | `write` | Push the exact attested archive the scan approved; no scanner, no Docker |
| Promote | `write` | Copy exact digest into applications package |
| Independent rescan | `read` | Scan immutable promoted digest |
| Independent verification | none | Sign local scan decision evidence; no registry login |
| Final signing | `write` | Sign approved application digest and attach attestations |

**Critical GHCR distinction:** `packages: write` is a token permission upper bound, not a package-specific allowlist. For private packages, configure **Package settings → Manage Actions access** and explicitly grant the security repository appropriate access; packages published by the same repository may already grant that repository admin access. A malicious or compromised write-enabled job can potentially write to *any* GHCR package accessible to that repository. Environment reviewers protect access to **secrets** and jobs, but cannot grant per-package permissions to `GITHUB_TOKEN`. If you require the equivalent of truly isolated Harbor robot accounts/projects, split intake, approval, and application publication across separately authorized repositories/identities (or retain Harbor). See `docs/THREAT-MODEL.md`.

New packages may have granular permission behavior depending on how they are linked to source repositories. Verify access in GitHub UI and by testing actual pulls/pushes; do not infer it from the image path or the OCI `source` label.

For a **private** GHCR package consumed from EKS, create a Kubernetes `imagePullSecret` using a supported credential (for example a dedicated `read:packages` classic PAT with minimal access and expiry), attach it to the workload ServiceAccount, and separately configure Kyverno's registry-credential secret if admission-time verification requires it. `GITHUB_TOKEN` is short lived and only available to Actions jobs; it is not an EKS long-term pull credential. Public packages can be pulled anonymously.

## 3. Applications, repository variables and secrets

Releasable applications are listed in **`policy/applications.json`** on protected `main`, one entry per GHCR package name (the dispatch input `app_name`):

```json
{
  "schema": "https://example.org/ghcr-application-allowlist/v1",
  "applications": {
    "myapp": {"source_repo": "acme/myapp", "dockerfile": "Dockerfile", "build_outputs": "target/myapp.jar"}
  }
}
```

Adding or changing an application is a reviewed pull request; the person dispatching a release can only choose an entry. One security repository can therefore release any number of applications (v2 needed one repository per application). Every job resolves the entry itself from its own checkout of the same commit.

Set repository **variables** (not credentials):

| Variable | Example | Reason |
|---|---|---|
| `GHCR_NAMESPACE` | `acme` | GHCR organization/owner, lowercase |
| `RELEASE_GATE_URL` | `https://gate.example.org/grants` | Independent signed release authorization endpoint |
| `RELEASE_GATE_ISSUER` | chosen trusted issuer | Exact issuer identity |
| `RELEASE_GATE_SCHEMA` | approved predicate URI | Exact grant schema |
| `RELEASE_REQUIRED_CHECKS` | chosen external required checks | Checks from protected release gate |

**Secrets** (place only in the appropriate protected environments or narrowly scoped repository secrets):

- `APPROVAL_PUBKEY_B64`: base-image approval **public** key, as a repository secret (read by jobs in several environments and by the base precheck/evaluate jobs, which have none). Its integrity matters, not its secrecy.
- `APPROVAL_PRIVATE_KEY_B64`, `COSIGN_PASSWORD`: base-image approval signer, only in `base-manual-approval` and `base-auto-promotion`.
- `APPLICATION_READ_TOKEN`: read-only token for **private application source checkout**, **only** in the `application-source-read` environment (used by the `authorize` job alone). It must be able to read every allowlisted application repository - a fine-grained token limited to those repositories with `Contents: read`. Rotate it in that one place. Later jobs receive the source as a hash-checked `git archive` (no `.git`); builds read `APP_COMMIT`, `SOURCE_DATE_EPOCH` and `BUILD_OUTPUT_TIMESTAMP` instead of running git.
- `RELEASE_GATE_PUBKEY_B64`, `VERIFIER_PRIVATE_KEY_B64`, `VERIFIER_PUBLIC_KEY_B64`: gate and independently protected scanner decision.
- `APP_COSIGN_KEY_B64`, `APP_COSIGN_PUBKEY_B64`: application signing keys.

Do **not** create Harbor-style `GHCR_*_USER/PASS` secrets: this GHCR variant uses job-specific GitHub tokens. The approval and signing keys are **not** supplied to image builders or the candidate scanner.

## 4. GitHub environments (configure protection in UI)

The repository audit now requires **real main-branch UPDATE protection**, not simply creation restrictions. Protect `main` with required PR reviews, stale-review dismissal, required successful status checks, and no unreviewed bypass actors. The `ci/audit_repo_settings.py` command needs an administrative token with permissions to read branch protection and rulesets. A successful audit is not proof of protected GHCR package-write permissions; perform live negative push tests.


- `ghcr-quarantine`: the quarantine copy job only; no signing secrets.
- `base-manual-approval`: **required reviewers** with **Prevent self-review**, key-based approval signing secret.
- `base-auto-promotion`: tightly protected automation key; its job may run only on an `AUTO_PASS` policy result.
- `application-source-read`: `APPLICATION_READ_TOKEN` only; no publication credentials.
- `ghcr-read-only`: image builders, scan and rescan (read-only package access); keep runners ephemeral.
- `ghcr-candidate-writer`: unsigned candidate push; no signing keys, no scanner.
- `application-high-cve-review`: **required human reviewer** with **Prevent self-review**. The workflow also refuses an approval by the person who dispatched the run, and only counts approvals of this environment.
- `ghcr-application-promoter`: copy exact, builder-authenticated candidate to application package, but NO signing keys.
- `independent-verification`: isolated verifier key; no registry write token.
- `ghcr-application-signing`: isolated signer, required release gate, no image tar parsing, protected signing key.

Protect central `main` with rulesets / required checks, CODEOWNERS and restricted workflow modification. Apply GitHub environment deployment branch restrictions (exactly `main`) and required reviewers. Job labels/environment names in YAML **do not** create these controls automatically.

**Restrict who can create branches and tags.** Anyone who can push a branch or tag to this repository can dispatch a *modified* workflow from it; that run gets whatever `permissions:` it asks for, including `packages: write` on every package this repository can write. Environment branch rules keep environment secrets away from such a run, but not the `GITHUB_TOKEN`. Create active rulesets that include `~ALL` branches and `~ALL` tags with the *Restrict creations* rule, and keep their bypass lists to the people who may change workflows. Set *Settings → Actions → General → Workflow permissions* to read-only and do not allow Actions to approve pull requests.

Then check everything above with:

```bash
GH_TOKEN=<repository admin token> python3 ci/audit_repo_settings.py --repo acme/security-pipelines
```

It fails on a missing environment, an environment whose deployment branches are anything but a custom policy of exactly `main` ("protected branches only" is refused), a reviewer environment without required reviewers or *Prevent self-review*, write-by-default workflow permissions, missing or bypassable branch/tag creation rulesets, or a `main` that can be changed without review and checks.

How it judges bypass lists:

- A ruleset only counts when the API answer contains its bypass list. If the list is missing, the script says so; rerun it with a token that can manage that ruleset (organisation rulesets need an organisation-level token).
- The ruleset that protects `main` must have an empty bypass list; classic branch protection must have no pull-request bypass allowances.
- The branch and tag creation rulesets may be bypassed by repository admins and organisation admins. Any other repository role fails. Teams, apps and deploy keys are printed as `CHECK MANUALLY` lines; confirm they contain only people and apps that may change workflows (Renovate needs such a bypass to open pull requests from branches).

**PoC (solo maintainer):** with `"allow_self_approval": true` in `policy/config.json`, the
reviewer environments keep a required reviewer (you) but *Prevent self-review* stays off, and
`ci/environment_approver.py` records an approval by the initiator as `self:<login>`. The audit
then also accepts a `main` ruleset that requires a pull request with zero approvals. Set the
switch to `false` as soon as a second reviewer exists.

## 5. Pinned tools

Every job installs its tools with `ci/install_verified_tools.py --kind <job>` from `ci/toolchain.lock.json`:

| Tool | Version | Used for |
|---|---|---|
| crane | v0.22.1 | registry reads, digest-checked copies, candidate push |
| cosign | v3.1.4 | signatures and attestations (key-based, no transparency log) |
| Syft | v1.57.2 | SBOMs |
| Grype | v0.122.0 | vulnerability scans |
| diffoci | v0.1.8 | layer-aware diff for reviewers |
| gh | v2.105.0 | artifact attestation verification, approvals API |
| actionlint | v1.7.12 | workflow lint in the PR check |

A download is installed only when its size and SHA-256 equal the lock. `ci/require_tools.sh` then refuses any of these tools that resolves to a copy outside the verified directory, so a different `gh` from the runner image is never used. `python3`, `sha256sum`, `jq`, `git`, `curl` and `openssl` still come from the runner image, and Docker from the SHA-pinned `setup-docker-action` at a fixed version.

The hashes in the lock were compared with each publisher's checksum file from the same release. That does not protect against a compromised release. Before production use, verify the checksum files' signatures (cosign/Sigstore for cosign, Syft and Grype; GitHub attestations for gh) and record who did it. To update a tool, change `version`, `url`, `sha256` and `size` together in one reviewed pull request; base-image approvals are then re-evaluated on the next run.

cosign v3 stores signatures and attestations in its new bundle format (on GHCR as a `sha256-<digest>` tag). `cosign verify` and `verify-attestation` from the same version read it; **test that your Kyverno version does too** before enforcing the policies.

## 6. Bootstrap and execution

The catalog initially contains an unpinned Temurin reference. Allow Renovate to propose the digest or pin an independently verified real upstream digest manually. **Never invent a SHA-256 digest.** A separate operator-controlled bootstrap must verify, import, sign and attest the first GHCR approved baseline because the normal comparison requires an existing approved digest.

Run base approval from central protected `main` after the digest PR is merged. A run stops after the read-only precheck when the pinned digest is already the approved one and its signed approval (a) has an accepted policy version, (b) is not too old and (c) carries today's policy fingerprint. The fingerprint covers the base-evaluation code, its settings and the tool pins. The pipeline copies the whole multi-platform index with the pinned `crane copy` (manifests are copied byte for byte) and then hashes the destination's manifest itself to confirm the digest; skopeo is no longer used because it has no release binary that could be pinned. After a change to the base-evaluation code, its settings or the tool pins, the next run re-evaluates the approved digest and, after review, signs a fresh record; no manual bootstrap is needed. Application-side changes (the allowlist, application exceptions, the release workflow) do not trigger this. New application builds require `accepted_approval_policy_versions` (currently v6 only) AND the current base policy fingerprint. Historical approvals in `historical_baseline_policy_versions` may be used only as comparison baselines, not as trusted application bases. Reapprove each consumed base image before running the new publishing workflow. Cosign signs the approved GHCR digest, not the upstream digest. GHCR availability of OCI signatures and attestations must be tested on your chosen Cosign version.

Use the application example and its `ci/build_and_test.sh` in a **separate app repo**. After the external release service issues a signed authorization for the exact protected app main HEAD:

```bash
gh workflow run application-release.yml --repo acme/security-pipelines --ref main \
  --field app_name=myapp --field app_commit=<FULL_40_HEX_SHA>
```

Two independent compiles produce matching artifacts; two image builds produce matching image **config digests** (read from each saved archive and GitHub-attested together with the archive and the base-image lists). The read-only scan job verifies all of that and computes the digest `crane push` will produce; the separate push job pushes the attested archive and must get exactly that digest. The promoter verifies both attested config digests and requires the candidate manifest's `config.digest` to equal them.

> Do not compare `docker image inspect .Id` with a registry: with the containerd image store (required here) `.Id` is the OCI *manifest* digest, and a push may rewrite the manifest. v2 did exactly that, and promote rejected every release.

### Critical CVE exceptions for applications

A Critical (or unrated) finding blocks the release unless `policy/config.json` has an unexpired exception for that CVE, package, version and platform, scoped either to:

- `image_ref`: the exact release image, `ghcr.io/<owner>/applications/<app>@sha256:<digest>`. Builds are reproducible, so the digest is known before release: a blocked run prints it as "Release digest" in the scan job summary (and as `release_ref` in `vulnerability-decision.json` of the `scanned-evidence` artifact). Commit the exception through a reviewed PR and dispatch the same commit again.
- `base_image_ref`: the exact approved base image. It applies to an application only when Grype found the package in a base layer **and** `ci/check_additive_layers.py` proved that the application layers never overwrite, delete or write through a base path (`layer-overlay.json`, `"additive": true`). Images whose own layers change base files (for example `apt-get upgrade` in the application Dockerfile) need `image_ref` exceptions. A separate verifier rescans the exact promoted digest, then the final signer verifies current evidence and independent release authorization.

**GitHub artifact attestations:** verify availability for your plan/repository visibility before deployment. `actions/attest` needs `id-token: write` and `attestations: write` and artifact verification uses a supported `gh` version. GitHub provenance and your internal Cosign approval attestations are separate artifacts with different trust semantics.

**PoC bootstrap:** dispatch `.github/workflows/base-bootstrap.yml` with `confirm_digest` set
to the catalog pin and approve it in `base-manual-approval`. It copies that digest into
`approved/`, signs a record marked `"bootstrap": true` without the policy fingerprint, and
sets the tracking tag; it refuses to run when the tag exists. Then dispatch
`base-image-approval.yml`: the precheck answers `needed`, the digest is evaluated against itself
and, after your review, signed with the current fingerprint. Only that record lets
applications build on it.

## 7. Kyverno and Flux

Change `ghcr.io/example-org` to your real owner in all `examples/kyverno-*.yaml` and the audit variants. Replace public keys and `ORG/SECURITY_REPO`, create `ghcr-kyverno-pull` if the registry is private, and test both single-container and mixed-sidecar Pods. Enable audit policies in staging first. Validate API compatibility with your deployed Kyverno release; YAML parsing alone is insufficient.

Deploy the **signed** immutable application digest: `ghcr.io/acme/applications/myapp@sha256:<digest>`. To deploy from private GHCR, Kubernetes needs an appropriate `imagePullSecret`. The production admission examples require a separate signed release approval after staging tests/DAST; the project does not automatically generate this external approval.

## 8. Mandatory staging checks

Test (a) allowed versus denied package Actions permissions (including a run dispatched from a non-main branch or tag), (b) fully private GHCR pull from EKS, (c) multi-arch digest-preserving imports, (d) signature/attestation discoverability via GHCR, (e) unsigned candidate rejected by Kyverno, (f) altered builder config ID rejected, (g) new unfixed Critical CVE rejected, (h) expired release grant rejected, (i) stale or moved tracking tag rejected, (j) failed external release gate, and (k) signing-key unavailability fails closed.

There is **no registry-level compare-and-swap of GHCR tracking tags** in this example. Protect against out-of-band writers; prefer digest-only consumers. See `docs/THREAT-MODEL.md` before any production signing deployment.
