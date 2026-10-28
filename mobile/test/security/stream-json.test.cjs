const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const { test } = require('node:test');

// Exercise the copies resolved by Detox and bunyamin, the consumers named in Dependabot alerts
// #84 (GHSA-mjw6-4jj6-33hc) and #82 (GHSA-528h-pc64-c93x); both use the vendored backport.
const consumers = ['detox', 'bunyamin'];

function run(streamJson, text, ...stages) {
  return new Promise((resolve, reject) => {
    let stream = Readable.from([text]).pipe(streamJson('Parser').parser());
    for (const stage of stages) stream = stream.pipe(stage).on('error', reject);
    const values = [];
    stream.on('data', (data) => values.push(data.value)).on('end', () => resolve(values));
  });
}

for (const consumer of consumers) {
  const load = (module) => createRequire(require.resolve(consumer))(`stream-json/${module}`);

  test(`${consumer}: the Assembler stores __proto__ as an own property, like JSON.parse`, async () => {
    const [value] = await run(load, '{"__proto__":{"isAdmin":true}}', load('streamers/StreamValues').streamValues());
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.equal(value.isAdmin, undefined);
    assert.deepEqual(value, JSON.parse('{"__proto__":{"isAdmin":true}}'));
  });

  test(`${consumer}: path filters reject input nested deeper than 1024 levels`, async () => {
    const deep = `${'{"meta":'.repeat(1100)}1${'}'.repeat(1100)}`;
    await assert.rejects(run(load, deep, load('filters/Pick').pick({ filter: 'data' })),
      /JSON nesting depth exceeds maxDepth \(1024\)/);
  });

  test(`${consumer}: ordinary filtering and streaming are unchanged`, async () => {
    const values = await run(load, '{"data":[1,{"a":2}],"meta":{}}',
      load('filters/Pick').pick({ filter: 'data' }), load('streamers/StreamArray').streamArray());
    assert.deepEqual(values, [1, { a: 2 }]);
  });
}
