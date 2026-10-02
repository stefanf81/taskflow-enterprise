# Vendored node-forge patch

This directory holds the TaskFlow backport of the `node-forge` RSA PKCS#1 v1.5
signature-verification fix (Dependabot alert #72 /
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) /
CVE-2026-85393) until upstream publishes a fixed release.

- `node-forge-1.4.0.patch` — human-readable unified diff (upstream
  [PR #1152](https://github.com/digitalbazaar/forge/pull/1152), commit
  `ceba34402e329f0365134f23fe19898756527d65`).
- `node-forge-1.4.0-patched.tgz` — official `node-forge@1.4.0` with the patch
  applied. Referenced by `mobile/package.json` `overrides`, so it is installed
  on every `npm install`/`npm ci` (including `--ignore-scripts`) while keeping
  `package-lock.json` at lockfileVersion 3 (which Renovate can parse).
- `rebuild-node-forge-patch.sh` — regenerates the tarball from the official
  registry release, verifying its sha512 checksum and re-applying the patch.

Regenerate with:

```bash
./rebuild-node-forge-patch.sh
```

When upstream ships a fixed `node-forge`, delete this directory, remove the
`node-forge` entry from `mobile/package.json` `overrides`, regenerate the
lockfile, and rerun the mobile tests (which include the security regression
suite in `mobile/test/security/`).
