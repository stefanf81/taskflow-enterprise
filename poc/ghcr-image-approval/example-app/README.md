# ghcr-approval-poc-app

Toy Java application for the GHCR image approval proof of concept. It is released only by
the central security repository `stefanf81/ghcr-approval-poc`, which lists it in
`policy/applications.json` as `example-app`:

- `ci/build_and_test.sh` builds `target/app.jar` byte-for-byte reproducibly (the jar's
  timestamps come from the commit time; the release pipeline compiles twice and compares).
- `Dockerfile` builds offline on the approved, signed Temurin 21 base.
- `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`; its `test`
  check-run on the `main` HEAD is what the release gate (`stefanf81/ghcr-approval-poc-gate`)
  requires before it signs a release grant.

Local build: `BUILD_OUTPUT_TIMESTAMP=2026-11-20T12:00:00Z ./ci/build_and_test.sh` (without the
variable the script reads the commit time with `git`).
