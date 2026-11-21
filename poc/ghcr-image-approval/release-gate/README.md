# base-image-gatekeeper-release-gate

PoC stand-in for the **external release-authorization service** that the GHCR image approval
kit (`stefanf81/base-image-gatekeeper-pipeline`) requires and does not supply. Its release workflow fetches
`$RELEASE_GATE_URL/<commit>` twice, when the release starts and again just before it signs,
and accepts only a signed grant issued at most 10 minutes earlier.

## What it does

`release-gate.yml` runs in the `release-gate` environment, which holds the signing key. It is
dispatched by hand with `repository`, `commit` and `minutes` (1–90, default 90: long enough
for the whole release, cancel it once the release has signed). Every 60 seconds it:

1. reads the application's `main` HEAD and the commit's push workflow runs on `main` from the
   GitHub API (`actions/runs?head_sha=…&event=push&branch=main`);
2. refuses, and withdraws any published grant, unless:
   - the commit **is** `main` HEAD;
   - for every gate check in `allowlist.json`, the newest push run of the named workflow
     **file** (`.github/workflows/ci.yml`) on `main` of that repository succeeded. Matching the
     file, not a job or check-run name, means another workflow's `test` job or a check-run
     created through the API never counts;
3. signs a fresh record (`issue_grant.py`, `openssl dgst -sha256 -sign`, valid 15 minutes) and
   pushes it as the single file `<commit>` on the orphan `grants` branch.

A required run that has **not finished** yet is not a refusal. This covers CI re-run during a
release, or the gate started before CI was done. The gate issues no new grant that round and
asks again a minute later. A grant published earlier is left as it is; the pipeline stops
accepting it 10 minutes after it was issued, so a long-running re-run still leads to a refusal
at the release's next fetch. Only a finished run that did not succeed, or a moved `main` HEAD,
withdraws the grant and ends the run.

The pipeline reads it from
`https://raw.githubusercontent.com/stefanf81/base-image-gatekeeper-release-gate/refs/heads/grants/<commit>`,
so `RELEASE_GATE_URL` is that URL without `/<commit>`. raw.githubusercontent.com caches for up
to 5 minutes; with the 60-second re-issue a fetched grant is at most about 6.5 minutes old.

When the run ends, fails or is **cancelled**, a final step stops the loop and publishes an
empty branch: that is revocation.
- **Late pushes:** the loop pushes with `--force-with-lease` against the commit it pushed last.
  So a grant push that was still in flight when the run was cancelled cannot land after the
  withdrawal: GitHub rejects it and the loop exits.
- **One grant at a time:** a second dispatch waits until the running one has ended, so cancel
  the running one before granting another commit.
- **Retries:** a GitHub API call or push that fails is retried twice; after that the run stops
  and the grant is withdrawn.

## Setup

1. Key pair (EC P-256; the private key never leaves the environment):

   ```bash
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out gate.key
   openssl pkey -in gate.key -pubout -out gate.pub
   base64 -w0 gate.key   # -> secret GATE_PRIVATE_KEY_B64 of environment release-gate
   base64 -w0 gate.pub   # -> secret RELEASE_GATE_PUBKEY_B64 of stefanf81/base-image-gatekeeper-pipeline
   ```

2. Environment `release-gate`: deployment branches = custom policy `main`; secret
   `GATE_PRIVATE_KEY_B64`. Optionally a required reviewer, if each grant should need a click.
3. *Settings → Actions → General → Workflow permissions*: leave read-only; the job asks for
   `contents: write` itself (it only pushes the `grants` branch).
4. Values the security repository needs: `RELEASE_GATE_ISSUER=base-image-gatekeeper-release-gate`,
   `RELEASE_GATE_SCHEMA=https://example.org/verified-release/v1`,
   `RELEASE_REQUIRED_CHECKS=tests` (the gate check names in `allowlist.json`).

## Tests

`python3 -m unittest discover -s tests` (needs python3, openssl, bash and git; about half a
minute); the same runs in `test.yml`. `tests/test_serve_grants.py` runs the publishing loop
against a local repository and a stub `gh`. It covers:
- the real workflow step stopping on SIGINT;
- withdraw stopping a running loop;
- a loop that survives the withdrawal failing to publish again;
- waiting through an unfinished CI run, and refusing a failed one;
- strict `minutes` validation.

`GRANT_INTERVAL_SECONDS` (1–60, default 60) exists only so the tests can run the loop quickly.

## Limits (PoC)

- The grant is public; it only says "this commit may be released" and carries no secret.
- The key sits in a GitHub environment of a repository you control: this separates duties
  from the security repository, but it is not an independently operated service.
- A cached `404` (fetched before the first grant was pushed) can be served for up to
  5 minutes: wait for the first "re-issued" log line before dispatching the release.
- Withdrawal empties the branch at once, but a copy cached by raw.githubusercontent.com can
  be served for up to 5 minutes more, and the pipeline accepts a grant for 10 minutes after it
  was issued.
