#!/usr/bin/env node
/**
 * TaskFlow OpenAPI to TypeScript Contract Synchronizer
 *
 * Fetches the backend OpenAPI spec (GET /v3/api-docs) and generates
 * TypeScript interface definitions in shared/types/api.ts.
 *
 * Usage: node scripts/sync-api-types.js [optional_openapi_url_or_file]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_URL = 'http://localhost:8080/v3/api-docs';
const TARGET_FILE = path.resolve(__dirname, '../shared/types/api.ts');

// ---------------------------------------------------------------------------
// JSON Schema → TypeScript type mapping
// ---------------------------------------------------------------------------
function mapSchemaType(schema, schemas) {
  if (!schema) return 'unknown';

  // Handle $ref: resolve to the referenced type name
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop();
    return refName;
  }

  if (schema.enum) {
    // Enum of strings → union type
    return schema.enum.map((v) => `'${v}'`).join(' | ');
  }

  switch (schema.type) {
    case 'string':
      if (schema.format === 'date-time' || schema.format === 'date') return 'string';
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `${mapSchemaType(schema.items, schemas)}[]`;
    case 'object':
      if (schema.properties) {
        const props = Object.entries(schema.properties)
          .map(([key, prop]) => {
            const required = schema.required?.includes(key);
            const opt = required ? '' : '?';
            const type = mapSchemaType(prop, schemas);
            const desc = prop.description ? `  /** ${prop.description} */\n` : '';
            return `${desc}  ${key}${opt}: ${type};`;
          })
          .join('\n');
        return `{\n${props}\n}`;
      }
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
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
        try { resolve(JSON.parse(rawData)); }
        catch (e) { reject(e); }
      });
    });
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', (err) => reject(err));
  });
}

function generateTypesFromSchemas(schemas) {
  const lines = [];
  const syncTimestamp = new Date().toISOString();

  lines.push('/**');
  lines.push(' * Single Source of Truth API Contracts for TaskFlow.');
  lines.push(' * Auto-generated from Backend OpenAPI schema (GET /v3/api-docs).');
  lines.push(` * Last synced: ${syncTimestamp}`);
  lines.push(' *');
  lines.push(' * DO NOT EDIT MANUALLY — run `npm run sync:api-types` to regenerate.');
  lines.push(' */');
  lines.push('');

  for (const [name, schema] of Object.entries(schemas)) {
    if (schema.enum || schema.type) {
      const typeDef = mapSchemaType(schema, schemas);
      if (schema.description) {
        lines.push(`/** ${schema.description} */`);
      }
      if (schema.enum && typeof typeDef === 'string') {
        lines.push(`export type ${name} = ${typeDef};`);
      } else {
        lines.push(`export interface ${name} ${typeDef}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main() {
  const targetUrl = process.argv[2] || DEFAULT_URL;
  console.log(`📡 Fetching OpenAPI spec from ${targetUrl} ...`);

  try {
    const spec = await fetchOpenApiSpec(targetUrl);

    if (!spec.components || !spec.components.schemas) {
      throw new Error('Invalid OpenAPI document: missing components.schemas');
    }

    const schemas = spec.components.schemas;
    const schemaCount = Object.keys(schemas).length;
    console.log(`✅ OpenAPI Spec (${spec.info?.title || 'unknown'} ${spec.info?.version || ''}) retrieved — ${schemaCount} schemas.`);

    const generated = generateTypesFromSchemas(schemas);
    fs.writeFileSync(TARGET_FILE, generated, 'utf8');
    console.log(`✨ Generated TypeScript types → ${TARGET_FILE}`);
  } catch (err) {
    console.warn(`⚠️  Backend not reachable (${err.message}). Existing ${TARGET_FILE} preserved.`);
  }
}

main();
