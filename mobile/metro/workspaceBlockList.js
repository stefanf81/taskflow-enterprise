/**
 * Keeps Metro from crawling the parts of the hoisted workspace node_modules that the app cannot
 * reach. With npm workspaces every frontend dependency (Angular, Vite, Vitest, Playwright, ...)
 * is installed in <repo>/node_modules next to the mobile ones, and Metro watches that folder.
 *
 * The app's dependency closure is computed from the lockfile the same way Node resolves modules
 * (nearest node_modules first), starting from mobile/package.json and shared/schemas. Every
 * top-level package outside the closure becomes a blockList entry.
 */
const fs = require('fs');
const path = require('path');

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function reachablePackages(lock, entryPoints) {
  const packages = lock.packages;
  const resolve = (fromKey, name) => {
    let dir = fromKey;
    for (;;) {
      const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
      if (packages[candidate]) {
        const entry = packages[candidate];
        return entry.link ? entry.resolved : candidate;
      }
      if (!dir) return null;
      const idx = dir.lastIndexOf('/node_modules/');
      dir = idx >= 0 ? dir.slice(0, idx) : dir.includes('/') && !dir.startsWith('node_modules/')
        ? dir.slice(0, dir.lastIndexOf('/'))
        : '';
    }
  };

  const seen = new Set();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const key = queue.pop();
    if (seen.has(key) || !packages[key]) continue;
    seen.add(key);
    const entry = packages[key];
    const names = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
      // Workspace roots: dev tooling (Jest, Babel presets) is loaded by Metro and its transformer.
      ...(entryPoints.includes(key) ? entry.devDependencies : {}),
    };
    for (const name of Object.keys(names)) {
      const target = resolve(key, name);
      if (target) queue.push(target);
    }
  }
  return seen;
}

/** RegExps for every top-level `<workspaceRoot>/node_modules/<package>` outside the app's closure. */
function workspaceBlockList(workspaceRoot, entryPoints = ['mobile', 'shared/schemas']) {
  const lockPath = path.join(workspaceRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return [];
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const reachable = reachablePackages(lock, entryPoints);

  const unreachable = Object.keys(lock.packages).filter(
    (key) =>
      key.startsWith('node_modules/') &&
      !key.slice('node_modules/'.length).includes('/node_modules/') &&
      !reachable.has(key) &&
      !lock.packages[key].link,
  );
  return unreachable.map(
    (key) => new RegExp(`^${escape(path.join(workspaceRoot, key))}(?:[\\\\/].*)?$`),
  );
}

module.exports = { workspaceBlockList, reachablePackages };
