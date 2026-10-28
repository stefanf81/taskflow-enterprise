# Vendored dependency patches

This directory holds TaskFlow backports of upstream security fixes until the
maintainers publish fixed npm releases.

- `*.patch` — human-readable unified diffs of the upstream fixes.
- `*-patched.tgz` — official registry releases with the patch applied.
  Referenced by the root `package.json` `overrides` (`file:mobile/vendor/...`), so they are
  installed on every `npm install`/`npm ci` (including `--ignore-scripts`) while keeping
  `package-lock.json` at lockfileVersion 3 (which Renovate can parse).
- `rebuild-*.sh` — regenerate each tarball from the official registry release,
  verifying its sha512 checksum and re-applying the patch.

Regenerate with:

```bash
./rebuild-braces-patch.sh
./rebuild-deepmerge-patch.sh
./rebuild-stream-json-patch.sh
```

The rebuilt tarball has new bytes (gzip embeds a timestamp), so the
`integrity` recorded for it in the root `package-lock.json` goes stale and the
next `npm ci` fails. Refresh and verify before committing (from the repository
root):

```bash
npm install
npm ci
npm test --workspace mobile
```

Commit the regenerated tarball together with `package-lock.json`. If a bare
`npm install` reports `ENOENT ... node_modules/<dependent>/vendor/...`, that is
npm resolving a `file:` override relative to the dependent package; restore the
stale entry to `file:mobile/vendor/<tarball>` with the rebuilt tarball's sha512
integrity, then use `npm ci`. Check with an empty cache
(`npm ci --cache "$(mktemp -d)"`): a populated `~/.npm` cache can hide a wrong path.

`npm audit` still lists a vendored package, because it matches the name and version and ignores
`resolved`; the regression suites in `mobile/test/security/` are the evidence that the fix is
installed.

## braces CVE-2026-93687

Dependabot alert #73 /
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Jest's `micromatch@4.0.8` uses `braces@3.0.3`, whose recursive AST walkers lack
a nesting-depth guard. `braces-3.0.3.patch` backports upstream
[PR #72](https://github.com/micromatch/braces/pull/72), commit
`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, capping nesting at `MAX_DEPTH = 100`.
See `mobile/README.md` for details.

## deepmerge GHSA-gcqx-w48m-w2h4

Dependabot alert #86 /
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) (CVE-2026-93753).
`@expo/config` and `jest-config` use `deepmerge@4.3.1`, the latest release; no fixed version
exists. `mergeObject()` assigns `destination[key] = …`, so an own `__proto__` key (as `JSON.parse`
creates it) in the target, or in a source merged over a primitive, replaces the merged result's
prototype. `deepmerge-4.3.1.patch` routes the three assignments in `index.js`, `dist/cjs.js` and
`dist/umd.js` through `setOwnProperty()`, which defines `__proto__` as an own data property.
Covered by `mobile/test/security/deepmerge-proto.test.cjs`.

## stream-json GHSA-mjw6-4jj6-33hc / GHSA-528h-pc64-c93x / GHSA-hqr4-qq8f-hg3x

Dependabot alerts #84, #82 and #85. Detox and bunyamin `require('stream-json/…')` 1.x CommonJS
paths; the fixes ship only in the ESM-only 3.x line, whose module layout they cannot load.
`stream-json-1.9.1.patch` backports:

- #84: upstream commit `2f2d35bbb547306991ded6487a279154d865a358` (3.6.0). `Assembler` stores a
  `__proto__` key as an own data property instead of calling the inherited setter.
- #82: the 3.5.0 depth cap. Path filters (`pick`, `ignore`, `filter`, `replace`) fail with a
  `RangeError` beyond 1024 nesting levels (`maxDepth` option), so deep input cannot make the
  per-token `stack.join()` quadratic.

#85 needs no code change: it is in the JSONC parser and verifier, which 1.x does not have
(`utils/Verifier.js` is the plain JSON verifier). Covered by
`mobile/test/security/stream-json.test.cjs`.

When upstream ships a fixed release, delete its patch,
tarball, and rebuild script, remove its root `package.json` `overrides`
entry, regenerate the lockfile, and rerun the mobile tests (which include the
regression suites in `mobile/test/security/`).
