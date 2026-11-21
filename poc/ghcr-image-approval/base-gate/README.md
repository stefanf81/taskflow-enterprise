# CI base-image gate

Part of the example app's CI (`.github/workflows/example-app-ci.yml`, job `base-image-gate`).
On every pull request and every push to `main` it checks whether the change moves a
digest-pinned base image. If it does, it scans the new image against the one pinned on
`main` and **fails the build** when the new image triggers a gate. The `test` job needs this
job, so a failed gate means no build. The release gate (`release-gate/`) only grants a commit
whose push run of this workflow succeeded, so a failed gate also blocks the release.

## What is compared

`config.json` → `dockerfiles` lists the watched Dockerfiles:
- `catalog/Dockerfile.temurin`: the upstream `eclipse-temurin` pin that base approval copies.
- `example-app/Dockerfile`: the approved GHCR base the app is built on.

The gate watches every file listed on `main` or in the change, so a pull request cannot stop
the gate from watching a Dockerfile by deleting it from the list.

| | Baseline (accepted) | Candidate |
| --- | --- | --- |
| Pull request | `main` the PR would land on: first parent of the merge commit that `actions/checkout` tests | the merge commit |
| Push to `main` | the commit before the push (`github.event.before`) | the pushed commit |

`plan.py` reads every `FROM` and pairs the pins by repository:

| Pin | What happens |
| --- | --- |
| unchanged | reported, nothing scanned (the usual case: seconds) |
| changed digest | old → new compared with the kit's engine |
| new repository | the image is compared with itself (see below) |
| removed | reported only |
| not pinned by digest, or `FROM $VAR` | the plan fails |

The first push to a new repository has no baseline and is skipped.

`compare_all.sh` runs, for each moved pin:
1. `crane digest` checks that both references resolve to their pinned digest;
2. the platform sets must match: platform drift is a block;
3. the kit's own `scripts/compare.sh` runs diffoci, Syft, Grype and the file inventory on every
   platform, and `scripts/evaluate.py` applies `policy/config.json`. This is the same engine
   and policy the base approval workflow uses, and it never runs image contents.

## What fails the build (`decide.py`)

| Finding class (from `evaluate.py`) | Examples | Gate |
| --- | --- | --- |
| block | new Critical CVE, newly SUID/SGID file, system directory made world-writable, `ONBUILD`, platform drift | **fail**; cannot be accepted here |
| attention | new High CVE, changed config field (`User`, `Entrypoint`, …), unexplained new/changed code, files in watched paths, suspicious symlinks, added/removed packages, downgrades | **fail**, unless accepted (below) |
| routine | version bumps, explained code changes, unverified upstream signature/provenance | reported only |

A new repository is compared with itself. `evaluate.py` then runs in its self-comparison
mode: it adds an attention reason and lists the image's absolute findings (SUID/SGID files,
world-writable paths, Critical/High CVEs). A new base image therefore always needs an
acceptance.

The run page shows every reason in the job summary. The full reports are uploaded as the
`base-image-gate-evidence` artifact.

## Accepting attention findings

Review the findings, then add an entry to `config.json` in the same pull request:

```json
"acceptances": [
  {"image": "docker.io/library/eclipse-temurin@sha256:<new digest>",
   "approved_by": "<github login>",
   "reason": "New High CVE in libfoo has no fix yet; not reachable from the JRE",
   "expires": "2026-12-31"}
]
```

- It covers every attention finding of exactly that image (`repository@sha256:digest`) until
  `expires` (at most 90 days ahead). Expired entries are ignored and can be deleted.
- It never covers a block. A new Critical CVE can only be excepted by the kit's scoped
  `policy/config.json` → `critical_exceptions`; that turns it into an attention finding, which
  then needs an acceptance too. Use `base_image_ref`, not `image_ref`: in a single repository
  `image_ref` no longer reproduces across commits.
- The push run after the merge compares the same pins again, so keep the entry until that
  run (and the release) has passed.

## Limits (PoC)

- A `pull_request` run uses the PR's own workflow file and scripts, so a PR could edit the
  gate itself. Review changes to `base-gate/`, `scripts/`, `policy/` and
  `.github/workflows/` (CODEOWNERS plus a required review once there is a second maintainer).
- Grype's database changes daily. A re-run can find a new High CVE in the same image, which
  an existing acceptance then covers until it expires.
- Docker Hub rate-limits anonymous pulls per runner IP; a failed `crane`/`syft` pull fails the
  gate (fail closed). Re-run the job.

## Tests

Run `python3 -m unittest discover -s base-gate/tests` (needs python3, git and bash; a few
seconds). The tests cover:
- the planner, against a real temporary git history;
- `compare_all.sh` with the kit's real `compare.sh` and `evaluate.py` against stub
  crane/syft/grype/diffoci;
- the decision rules;
- the workflow wiring.
