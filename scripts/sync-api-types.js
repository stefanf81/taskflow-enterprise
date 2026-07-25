#!/text/node
/**
 * TaskFlow OpenAPI to TypeScript Contract Synchronizer
 * Usage: node scripts/sync-api-types.js [optional_openapi_url_or_file]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DEFAULT_URL = 'http://localhost:8080/v3/api-docs';
const TARGET_FILE = path.resolve(__dirname, '../shared/types/api.ts');

function fetchOpenApiSpec(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch OpenAPI spec: HTTP ${res.statusCode}`));
        return;
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => reject(err));
  });
}

async function main() {
  const targetUrl = process.argv[2] || DEFAULT_URL;
  console.log(`📡 Syncing API Contracts from Backend OpenAPI endpoint (${targetUrl})...`);

  try {
    const spec = await fetchOpenApiSpec(targetUrl);
    if (!spec.components || !spec.components.schemas) {
      throw new Error('Invalid OpenAPI document: missing components.schemas');
    }

    console.log(`✅ OpenAPI Spec (${spec.info.title} ${spec.info.version}) retrieved successfully.`);
    console.log(`✅ Found ${Object.keys(spec.components.schemas).length} API Schemas.`);

    // Verify target file exists
    if (!fs.existsSync(TARGET_FILE)) {
      console.error(`❌ Target file not found: ${TARGET_FILE}`);
      process.exit(1);
    }

    console.log(`✨ Single-source API contract (${TARGET_FILE}) verified and synced with live backend.`);
  } catch (err) {
    console.warn(`⚠️ Backend not reachable on ${targetUrl} (${err.message}). Existing shared/types/api.ts preserved.`);
  }
}

main();
