const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Expo CLI 58 still requests Zod 3. Keep its scoped override on the app's
// patched Zod and exercise the CLI consumers before updating either package.
const cliRequire = createRequire(require.resolve('@expo/cli/package.json'));
const { PluginSchema, DevToolsPluginOutputSchema } = cliRequire(
  './build/src/start/server/DevToolsPlugin.schema.js',
);
const { createMCPDevToolsExtensionSchema } = cliRequire(
  './build/src/start/server/createMCPDevToolsExtensionSchema.js',
);

test('Expo CLI resolves the same patched Zod as the app', () => {
  assert.equal(cliRequire.resolve('zod'), require.resolve('zod'));
  // One lockfile at the repository root since the npm workspaces migration.
  const lock = require('../../../package-lock.json');
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path.endsWith('node_modules/zod')) continue;
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    assert.ok(
      major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))),
      `${path} contains vulnerable Zod ${pkg.version}`,
    );
  }
});

test('Expo plugin validation accepts valid plugins and rejects invalid metadata', () => {
  const plugin = PluginSchema.parse({
    packageName: 'test-plugin',
    packageRoot: '/test-plugin',
    cliExtensions: {
      description: 'Test commands',
      entryPoint: './commands.js',
      commands: [{
        name: 'inspect',
        title: 'Inspect',
        environments: ['cli', 'mcp'],
        parameters: [
          { name: 'label', type: 'text' },
          { name: 'count', type: 'number' },
          { name: 'enabled', type: 'confirm' },
        ],
      }],
    },
  });
  assert.equal(PluginSchema.safeParse({ packageName: '' }).success, false);
  const schema = createMCPDevToolsExtensionSchema(plugin);
  assert.deepEqual(schema.parse({
    command: 'inspect', label: 'test', count: 2, enabled: true,
  }), { command: 'inspect', label: 'test', count: 2, enabled: true });
  for (const input of [
    { command: 'unknown' },
    { command: 'inspect', count: 'two' },
    { command: 'inspect', unexpected: true },
  ]) {
    assert.equal(schema.safeParse(input).success, false);
  }
});

test('Expo output validation retains text, image and audio support', () => {
  const output = [
    { type: 'text', text: 'Ready', level: 'info' },
    { type: 'image', url: 'https://example.com/image.png' },
    { type: 'audio', url: 'https://example.com/audio.mp3' },
  ];
  assert.deepEqual(DevToolsPluginOutputSchema.parse(output), output);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'invalid' }]).success, false);
});
