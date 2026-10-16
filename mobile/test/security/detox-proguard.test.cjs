const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { addDetoxProguardRules } = require('../../plugins/withDetoxProguardRules');

const releaseBlock = (preset) => `
    buildTypes {
        release {
            shrinkResources enableShrinkResources.toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("${preset}"), "proguard-rules.pro"
        }
    }
`;

for (const preset of ['proguard-android-optimize.txt', 'proguard-android.txt']) {
  test(`adds the Detox keep rules after the ${preset} line`, () => {
    const result = addDetoxProguardRules(releaseBlock(preset));
    assert.match(result, /detox\/proguard-rules-app\.pro/);
    assert.match(result, /plugins\/detox-proguard-rules\.pro/);
    assert.ok(
      result.indexOf(`getDefaultProguardFile("${preset}")`) < result.indexOf('detox/proguard-rules-app.pro'),
    );
  });
}

test('applies the rules only to builds that include an androidTest APK', () => {
  const result = addDetoxProguardRules(releaseBlock('proguard-android-optimize.txt'));
  assert.match(
    result,
    /if \(gradle\.startParameter\.taskNames\.any \{ it\.toLowerCase\(\)\.contains\('androidtest'\) \}\) \{[\s\S]*proguardFile\(new File\(detoxPackageJson[\s\S]*\}/,
  );
});

test('the extra rules file keeps the Kotlin coroutine intrinsics the Detox runner needs', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../../plugins/detox-proguard-rules.pro'), 'utf8');
  assert.match(rules, /^-keep class kotlin\.\*\* \{ \*; \}$/m);
  assert.match(rules, /^-keep class androidx\.tracing\.\*\* \{ \*; \}$/m);
});

test('is idempotent', () => {
  const once = addDetoxProguardRules(releaseBlock('proguard-android-optimize.txt'));
  assert.equal(addDetoxProguardRules(once), once);
});

test('fails loudly when the template no longer has a proguardFiles line', () => {
  assert.throws(() => addDetoxProguardRules('android {}'), /could not find the release proguardFiles line/);
});
