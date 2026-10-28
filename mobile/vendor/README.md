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

## braces CVE-2026-93687

Dependabot alert #73 /
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Jest's `micromatch@4.0.8` uses `braces@3.0.3`, whose recursive AST walkers lack
a nesting-depth guard. `braces-3.0.3.patch` backports upstream
[PR #72](https://github.com/micromatch/braces/pull/72), commit
`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, capping nesting at `MAX_DEPTH = 100`.
See `mobile/README.md` for details.

When upstream ships a fixed release, delete its patch,
tarball, and rebuild script, remove its root `package.json` `overrides`
entry, regenerate the lockfile, and rerun the mobile tests (which include the
regression suites in `mobile/test/security/`).
