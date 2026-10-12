#!/usr/bin/env node
'use strict';

/**
 * Fails when app.json still carries the placeholder EAS project ID.
 *
 * `expo.extra.eas.projectId` ties the app to a real EAS project (builds, OTA
 * updates, push credentials). The value committed to this repository is a
 * placeholder (11111111-2222-3333-4444-555555555555); `eas build` against it
 * either fails or, worse, targets somebody else's project. Run `eas init` (or
 * paste the project ID from expo.dev) and commit the real UUID.
 *
 * Wired into `npm run build:android` / `npm run build:ios` and available as
 * `npm run check:eas`. It is deliberately NOT part of `npm test`: local
 * development and CI unit tests work without an EAS project.
 */

const fs = require('fs');
const path = require('path');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_PROJECT_IDS = new Set(['11111111-2222-3333-4444-555555555555']);

function findProblems(appJson) {
  const projectId = appJson?.expo?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || projectId.trim() === '') {
    return ['expo.extra.eas.projectId is missing. Run `eas init` to create/link the EAS project.'];
  }
  if (!UUID_PATTERN.test(projectId)) {
    return [`expo.extra.eas.projectId "${projectId}" is not a UUID.`];
  }
  const normalized = projectId.toLowerCase();
  // Placeholder: known sentinel or a run of one repeated digit/char (00000000-0000-...).
  if (
    PLACEHOLDER_PROJECT_IDS.has(normalized) ||
    /^(.)\1{7}-(\1{4}-){3}\1{12}$/.test(normalized) ||
    normalized.startsWith('11111111-')
  ) {
    return [
      `expo.extra.eas.projectId is still the placeholder "${projectId}". ` +
        'Run `eas init` (or copy the project ID from expo.dev) and commit the real value to mobile/app.json.',
    ];
  }
  return [];
}

function main() {
  const appJsonPath = path.join(__dirname, '..', 'app.json');
  const problems = findProblems(JSON.parse(fs.readFileSync(appJsonPath, 'utf8')));
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`check-eas-config: ${problem}`);
    }
    process.exit(1);
  }
  console.log('check-eas-config: EAS project ID looks valid.');
}

if (require.main === module) {
  main();
}

module.exports = { findProblems };
