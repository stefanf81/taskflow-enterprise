#!/usr/bin/env node
/**
 * Compares the full runtime OpenAPI document with the reviewed baseline.
 *
 * Usage:
 *   node scripts/check-openapi-contract.js [--auth] <openapi_url_or_file>
 *   node scripts/check-openapi-contract.js --write [--auth] <openapi_url_or_file>
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const BASELINE = path.resolve(__dirname, '../api/openapi.json');

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;
    const request = client.request(url, options, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Failed to load OpenAPI document: HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(5_000, () => {
      request.destroy(new Error('OpenAPI request timed out'));
    });
    request.on('error', reject);
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

async function authenticate(source) {
  const url = new URL(source);
  const credentials = JSON.stringify({
    username: process.env.OPENAPI_USERNAME || 'admin',
    password: process.env.OPENAPI_PASSWORD || 'admin-password',
  });
  const login = await requestJson(`${url.origin}/api/v1/auth/mobile/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(credentials),
    },
    body: credentials,
  });

  if (!login.accessToken) {
    throw new Error('OpenAPI authentication did not return an access token');
  }
  return `Bearer ${login.accessToken}`;
}

function loadDocument(source, authorization) {
  if (!source.startsWith('http://') && !source.startsWith('https://')) {
    return Promise.resolve(JSON.parse(fs.readFileSync(source, 'utf8')));
  }

  return requestJson(source, {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function serialize(document) {
  return `${JSON.stringify(canonicalize(document), null, 2)}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args[0] === '--write';
  const authenticateRequest = args.includes('--auth');
  const source = args.find((arg) => arg !== '--write' && arg !== '--auth');
  if (!source) {
    throw new Error('Usage: check-openapi-contract.js [--write] [--auth] <openapi_url_or_file>');
  }

  const authorization = authenticateRequest ? await authenticate(source) : undefined;
  const actual = serialize(await loadDocument(source, authorization));
  if (write) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, actual, 'utf8');
    console.log(`Updated OpenAPI baseline: ${BASELINE}`);
    return;
  }

  if (!fs.existsSync(BASELINE)) {
    throw new Error(`OpenAPI baseline is missing: ${BASELINE}`);
  }

  if (fs.readFileSync(BASELINE, 'utf8') !== actual) {
    throw new Error(
      'OpenAPI contract changed. Review the API change and run `npm run api:spec:update` to update the baseline.',
    );
  }

  console.log('OpenAPI contract matches the reviewed baseline.');
}

main().catch((error) => {
  console.error(`OpenAPI contract check failed: ${error.message}`);
  process.exitCode = 1;
});
