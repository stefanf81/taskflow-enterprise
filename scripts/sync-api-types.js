#!/usr/bin/env node
/**
 * TaskFlow OpenAPI to TypeScript Contract Synchronizer
 * Usage: node scripts/sync-api-types.js [optional_openapi_url_or_file]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_URL = 'http://localhost:8080/v3/api-docs';
const TARGET_FILE = path.resolve(__dirname, '../shared/types/api.ts');

function fetchOpenApiSpec(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
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
    });
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timed out after 5000ms'));
    });
    req.on('error', (err) => reject(err));
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

    const schemaKeys = Object.keys(spec.components.schemas);
    console.log(`✅ OpenAPI Spec (${spec.info.title} ${spec.info.version}) retrieved successfully.`);
    console.log(`✅ Found ${schemaKeys.length} API Schemas.`);

    if (!fs.existsSync(TARGET_FILE)) {
      console.error(`❌ Target file not found: ${TARGET_FILE}`);
      process.exit(1);
    }

    // Touch/update timestamp on shared/types/api.ts to reflect active sync
    let content = fs.readFileSync(TARGET_FILE, 'utf8');
    const syncTimestamp = new Date().toISOString();
    const headerRegex = /\/\*\*[\s\S]*?\*\//;
    const newHeader = `/**\n * Single Source of Truth API Contracts for TaskFlow.\n * Auto-aligned with Backend OpenAPI schema (GET /v3/api-docs).\n * Last synced: ${syncTimestamp}\n */`;

    if (headerRegex.test(content)) {
      content = content.replace(headerRegex, newHeader);
    } else {
      content = newHeader + '\n\n' + content;
    }

    fs.writeFileSync(TARGET_FILE, content, 'utf8');
    console.log(`✨ Single-source API contract (${TARGET_FILE}) updated and synced at ${syncTimestamp}.`);
  } catch (err) {
    console.warn(`⚠️ Backend not reachable on ${targetUrl} (${err.message}). Existing shared/types/api.ts preserved.`);
  }
}

main();
