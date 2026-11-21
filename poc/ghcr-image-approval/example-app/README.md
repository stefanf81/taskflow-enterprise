# example-app

Toy Java application that the pipeline in this repository releases. `policy/applications.json`
lists it as `example-app` (source `stefanf81/base-image-gatekeeper`, folder `example-app`).

- `ci/build_and_test.sh` builds `target/app.jar` byte-for-byte reproducibly. The jar's
  timestamps come from the commit time, and the release pipeline compiles twice and compares.
- `Dockerfile` builds offline on the approved, signed Temurin 21 base. The jar is copied with
  `--chmod=0444`: the pipeline builds under `umask 077`, and the non-root runtime user must
  still be able to read it.
- `.github/workflows/example-app-ci.yml` runs on pull requests and on pushes to `main`:
  - first the CI base-image gate (`base-gate/`), which fails the build when a moved base-image
    pin brings new block or attention findings;
  - then the build and tests.

  The release gate (`release-gate/`) signs a grant only for a `main` HEAD whose newest push
  run of that workflow file succeeded. If you rename or move the file, update
  `release-gate/allowlist.json`.

Local build, from this folder: `BUILD_OUTPUT_TIMESTAMP=2026-11-20T12:00:00Z ./ci/build_and_test.sh`
(without the variable the script reads the commit time with `git`).
