# base-image-gatekeeper

A proof of concept for **defending container builds against supply-chain attacks through their
base images**. A base image never reaches a build just because a new digest was published.
Every move of a pinned base is compared with the image it replaces:
- file by file;
- package by package;
- CVE by CVE.

New risks fail the build until a person has looked at them.

Everything lives in this one repository: the pipeline, the example app it releases, and the
gates.

| Path | What it is |
| --- | --- |
| `base-gate/` | **CI base-image gate.** Part of the app's CI. When a commit or pull request moves a digest-pinned base, it scans the new image against the one pinned on `main` and fails the build on block or attention findings ([README](base-gate/README.md)) |
| `catalog/`, `ci/`, `scripts/`, `policy/`, `docs/`, `examples/`, `tests/`, `.github/workflows/` (except the two below) | The GHCR image approval kit v6 (quarantine, diff/scan, review, cosign signing, two-builder application release) with the PoC changes listed in [docs/KIT.md](docs/KIT.md) |
| `example-app/`, `.github/workflows/example-app-ci.yml` | A small reproducible Java app built on the approved Temurin base, and its CI (base-image gate, then build and tests) |
| `release-gate/`, `.github/workflows/release-gate.yml` | Stand-in for the external release-authorization service the kit requires ([README](release-gate/README.md)) |
| [RUNBOOK.md](RUNBOOK.md) | Setup, first runs in order, negative tests, recovery |

## How a base image moves

```text
catalog/Dockerfile.temurin pins eclipse-temurin@sha256:NEW   (pull request)
  -> example-app-ci.yml / base-image-gate: compare main's sha256:OLD with sha256:NEW
       (diffoci, Syft, Grype, file inventory; never runs the image)
       block (new Critical CVE, new SUID/SGID, world-writable system dir, ONBUILD) -> build fails
       attention (new High CVE, config change, unexplained code, ...)            -> build fails,
                                                    unless accepted in base-gate/config.json
       routine (version bumps, explained changes)                                -> reported
  -> merge -> base-image-approval.yml: quarantine, the same comparison against the signed
     baseline, human review, cosign signature + approval attestation -> ghcr.io/<ns>/approved/
example-app/Dockerfile pins ghcr.io/<ns>/approved/eclipse-temurin@sha256:NEW   (pull request)
  -> base-image-gate compares again (the same image, now from the approved copy)
  -> merge -> CI on main green -> release gate grants that exact commit
  -> application-release.yml: two builders, attestations, scan, verifier, cosign signature
```

The CI gate is the early, per-change check, and it fails the build. The base approval
workflow is the signing authority: an application can only be built on a digest it has
approved and signed.

## Quick start

```bash
bash ci/validate-local.sh
```

That runs the offline checks and all three test suites (kit, base gate, release gate). Then
follow [RUNBOOK.md](RUNBOOK.md) to set up the repository and do a first live run.
