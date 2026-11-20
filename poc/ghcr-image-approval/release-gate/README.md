# ghcr-approval-poc-gate

PoC stand-in for the **external release-authorization service** that the GHCR image approval
kit (`stefanf81/ghcr-approval-poc`) requires and does not supply. Its release workflow fetches
`$RELEASE_GATE_URL/<commit>` twice, when the release starts and again just before it signs,
and accepts only a signed grant issued at most 10 minutes earlier.

## What it does

`release-gate.yml` (manual dispatch: `repository`, `commit`, `minutes`) runs in the
`release-gate` environment, which holds the signing key. Every 60 seconds it:

1. reads the application's `main` HEAD and the commit's check-runs from the GitHub API;
2. refuses, and withdraws any published grant, unless the commit **is** `main` HEAD and every
   check-run required by `allowlist.json` succeeded (only check-runs created by GitHub Actions
   count; for a re-run the latest one counts);
3. signs a fresh record (`issue_grant.py`, `openssl dgst -sha256 -sign`, valid 15 minutes) and
   force-pushes it as the single file `<commit>` on the orphan `grants` branch.

The pipeline reads it from
`https://raw.githubusercontent.com/stefanf81/ghcr-approval-poc-gate/refs/heads/grants/<commit>`,
so `RELEASE_GATE_URL` is that URL without `/<commit>`. raw.githubusercontent.com caches for up
to 5 minutes; with the 60-second re-issue a fetched grant is at most about 6.5 minutes old.

When the run ends, fails or is **cancelled**, a final step publishes an empty branch: that is
revocation. One grant at a time: dispatching for another commit replaces the previous grant.

## Setup

1. Key pair (EC P-256; the private key never leaves the environment):

   ```bash
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out gate.key
   openssl pkey -in gate.key -pubout -out gate.pub
   base64 -w0 gate.key   # -> secret GATE_PRIVATE_KEY_B64 of environment release-gate
   base64 -w0 gate.pub   # -> secret RELEASE_GATE_PUBKEY_B64 of stefanf81/ghcr-approval-poc
   ```

2. Environment `release-gate`: deployment branches = custom policy `main`; secret
   `GATE_PRIVATE_KEY_B64`. Optionally a required reviewer, if each grant should need a click.
3. *Settings → Actions → General → Workflow permissions*: leave read-only; the job asks for
   `contents: write` itself (it only pushes the `grants` branch).
4. Values the security repository needs: `RELEASE_GATE_ISSUER=stefanf81-poc-release-gate`,
   `RELEASE_GATE_SCHEMA=https://example.org/verified-release/v1`,
   `RELEASE_REQUIRED_CHECKS=tests` (the gate check names in `allowlist.json`).

## Tests

`python3 -m unittest discover -s tests` (needs python3 and openssl only); the same runs in
`test.yml`.

## Limits (PoC)

- The grant is public; it only says "this commit may be released" and carries no secret.
- The key sits in a GitHub environment of a repository you control: this separates duties
  from the security repository, but it is not an independently operated service.
- A newer cached `404` (fetched before the first grant was pushed) can be served for up to
  5 minutes: wait for the first "re-issued" log line before dispatching the release.
