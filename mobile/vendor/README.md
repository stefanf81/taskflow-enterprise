# Vendored dependency patches

This directory holds TaskFlow backports of upstream security fixes until the
maintainers publish fixed npm releases.

- `*.patch` — human-readable unified diffs of the upstream fixes.
- `*-patched.tgz` — official registry releases with the patch applied.
  Referenced by `mobile/package.json` `overrides`, so they are installed on
  every `npm install`/`npm ci` (including `--ignore-scripts`) while keeping
  `package-lock.json` at lockfileVersion 3 (which Renovate can parse).
- `rebuild-*.sh` — regenerate each tarball from the official registry release,
  verifying its sha512 checksum and re-applying the patch.

Regenerate with:

```bash
./rebuild-node-forge-patch.sh
./rebuild-braces-patch.sh
```

The rebuilt tarballs have new bytes (gzip embeds a timestamp), so the
`integrity` recorded for them in `mobile/package-lock.json` goes stale and the
next `npm ci` fails. Refresh and verify before committing (from the repository
root):

```bash
npm install --prefix mobile
npm ci --prefix mobile
npm test --prefix mobile
```

Commit the regenerated tarballs together with `mobile/package-lock.json`. If a
bare `npm install` reports `ENOENT ... node_modules/<dependent>/vendor/...`,
that is npm resolving a `file:` override relative to the dependent package;
restore the stale entry to `file:vendor/<tarball>` with the rebuilt tarball's
sha512 integrity, then use `npm ci`.

## node-forge CVE-2026-85393

Dependabot alert #72 /
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
Expo's CLI and `@expo/code-signing-certificates` use `node-forge@1.4.0`, whose
RSA PKCS#1 v1.5 verification accepts extra elements inside the nested
`DigestAlgorithm`. `node-forge-1.4.0.patch` backports upstream
[PR #1152](https://github.com/digitalbazaar/forge/pull/1152), commit
`ceba34402e329f0365134f23fe19898756527d65`. See `mobile/README.md` for details.

## braces CVE-2026-93687

Dependabot alert #73 /
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Jest's `micromatch@4.0.8` uses `braces@3.0.3`, whose recursive AST walkers lack
a nesting-depth guard. `braces-3.0.3.patch` backports upstream
[PR #72](https://github.com/micromatch/braces/pull/72), commit
`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, capping nesting at `MAX_DEPTH = 100`.
See `mobile/README.md` for details.

When upstream ships a fixed release for either package, delete its patch,
tarball, and rebuild script, remove its `mobile/package.json` `overrides`
entry, regenerate the lockfile, and rerun the mobile tests (which include the
regression suites in `mobile/test/security/`).
