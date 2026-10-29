// Expo's (experimental) Metro tree shaking for the release bundle. E2E release builds and the EAS
// `preview` profile run it so it gets device coverage; `production` follows after a green run.
// Shared by .detoxrc.js and CI's JavaScript-only repack (.github/scripts/repack-*-e2e.sh), which
// must bundle exactly like the native builds do.
module.exports = {
  EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH: '1',
  EXPO_UNSTABLE_TREE_SHAKING: '1',
};
