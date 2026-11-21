# ghcr-approval-poc-app

Toy Java application for the GHCR image approval proof of concept. It is released only by
the central security repository `stefanf81/ghcr-approval-poc`, which lists it in
`policy/applications.json` as `example-app`:

- `ci/build_and_test.sh` builds `target/app.jar` byte-for-byte reproducibly (the jar's
  timestamps come from the commit time; the release pipeline compiles twice and compares).
- `Dockerfile` builds offline on the approved, signed Temurin 21 base. The jar is copied with
  `--chmod=0444`: the pipeline builds under `umask 077`, and the non-root runtime user must
  still be able to read it.
- `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. A successful push
  run of this workflow file on the `main` HEAD is what the release gate
  (`stefanf81/ghcr-approval-poc-gate`) requires before it signs a release grant. If you rename
  or move the file, update the gate's `allowlist.json`.

Local build: `BUILD_OUTPUT_TIMESTAMP=2026-11-20T12:00:00Z ./ci/build_and_test.sh` (without the
variable the script reads the commit time with `git`).
