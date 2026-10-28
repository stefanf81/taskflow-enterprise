#!/usr/bin/env node
/**
 * Fails when a path listed in frontend/src/component-map.json or mobile/src/component-map.json
 * no longer exists. The maps tell humans and agents which web and mobile files implement the same
 * feature, so a moved file must be reflected there.
 *
 * Usage: node scripts/check-component-map.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAPS = ['frontend/src/component-map.json', 'mobile/src/component-map.json'];
const PATH_LIKE = /^(frontend|mobile)\/.+\.[A-Za-z0-9]+$/;

function collectPaths(value, found = []) {
  if (typeof value === 'string') {
    if (PATH_LIKE.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectPaths(item, found));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectPaths(item, found));
  }
  return found;
}

let missing = 0;
let checked = 0;
for (const map of MAPS) {
  const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, map), 'utf8'));
  for (const file of new Set(collectPaths(parsed))) {
    checked += 1;
    if (!fs.existsSync(path.join(ROOT, file))) {
      console.error(`${map}: ${file} does not exist`);
      missing += 1;
    }
  }
}

if (missing > 0) {
  console.error(`${missing} path(s) in the component maps do not exist.`);
  process.exit(1);
}
console.log(`Component maps are consistent (${checked} paths checked).`);
