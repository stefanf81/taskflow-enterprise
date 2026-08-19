#!/usr/bin/env node
/**
 * TaskFlow OpenAPI to TypeScript Contract Synchronizer
 *
 * Fetches the backend OpenAPI spec (GET /v3/api-docs) and generates
 * TypeScript interface definitions in both platform clients.
 *
 * Usage: node scripts/sync-api-types.js [--check] [optional_openapi_url_or_file]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_URL = 'http://localhost:8080/v3/api-docs';
const TARGET_FILES = [
  path.resolve(__dirname, '../frontend/src/app/types/api.ts'),
  path.resolve(__dirname, '../mobile/src/types/api.ts'),
];

// ---------------------------------------------------------------------------
// JSON Schema → TypeScript type mapping
// ---------------------------------------------------------------------------
const RESPONSE_SCHEMAS = new Set([
  'AppointmentDashboardResponse',
  'AppointmentResponse',
  'AppointmentStats',
  'BarberRatingResponse',
  'BarberResponse',
  'BarberTimeOffResponse',
  'LoginResponse',
  'MobileLoginResponse',
  'NotificationOutboxResponse',
  'PageableObject',
  'PagedModelAppointmentResponse',
  'PageMetadata',
  'PageObject',
  'PublicBarberResponse',
  'RegisterResponse',
  'ServiceItemResponse',
  'SortObject',
]);

function mapSchemaType(schema, schemas, schemaName) {
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
            const required = schema.required?.includes(key) || RESPONSE_SCHEMAS.has(schemaName);
            const opt = required ? '' : '?';
            const type = mapSchemaType(prop, schemas);
            const desc = prop.description ? `  /** ${prop.description} */\n` : '';
            const propertyName = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`;
            return `${desc}  ${propertyName}${opt}: ${type};`;
          })
          .join('\n');
        return `{\n${props}\n}`;
      }
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

const TYPE_ALIASES = {
  AppointmentItem: 'AppointmentResponse',
  AppointmentPage: 'PageObject',
  Barber: 'BarberResponse',
  PublicBarber: 'PublicBarberResponse',
  BarberRating: 'BarberRatingResponse',
  BarberTimeOff: 'BarberTimeOffResponse',
  NotificationItem: 'NotificationOutboxResponse',
  PublicCancelRequest: 'CancelRequest',
  ServiceItem: 'ServiceItemResponse',
};

const TYPE_OVERRIDES = {
  AppointmentUpdateRequest: "{\n  status: 'APPROVED' | 'DENIED';\n}",
  LoginResponse: "{\n  role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER';\n  username: string;\n}",
  MobileLoginResponse:
    "{\n  accessToken: string;\n  expiresIn: number;\n  role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER';\n  tokenType: 'Bearer';\n  username: string;\n}",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function loadOpenApiSpec(source) {
  if (!source.startsWith('http://') && !source.startsWith('https://')) {
    return Promise.resolve(JSON.parse(fs.readFileSync(source, 'utf8')));
  }

  return new Promise((resolve, reject) => {
    const client = source.startsWith('https') ? https : http;
    const req = client.get(source, (res) => {
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

  lines.push('/**');
  lines.push(' * Single Source of Truth API Contracts for TaskFlow.');
  lines.push(' * Auto-generated from Backend OpenAPI schema (GET /v3/api-docs).');
  lines.push(' *');
  lines.push(' * DO NOT EDIT MANUALLY — run `npm run sync:api-types` to regenerate.');
  lines.push(' */');
  lines.push('');

  for (const [name, schema] of Object.entries(schemas).sort(([left], [right]) => left.localeCompare(right))) {
    if (schema.enum || schema.type) {
      const typeDef = TYPE_OVERRIDES[name] || mapSchemaType(schema, schemas, name);
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

  for (const [alias, target] of Object.entries(TYPE_ALIASES)) {
    lines.push(`export type ${alias} = ${target};`);
  }

  return `${lines.join('\n')}\n`;
}

function formatForTarget(generated, targetFile) {
  // Mobile has no Prettier config and therefore uses its default double quotes.
  return targetFile.includes('/mobile/') ? generated.replace(/'([^']*)'/g, '"$1"') : generated;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  const source = args.find((arg) => arg !== '--check') || DEFAULT_URL;
  console.log(`Loading OpenAPI spec from ${source} ...`);

  try {
    const spec = await loadOpenApiSpec(source);

    if (!spec.components || !spec.components.schemas) {
      throw new Error('Invalid OpenAPI document: missing components.schemas');
    }

    const schemas = spec.components.schemas;
    const schemaCount = Object.keys(schemas).length;
    console.log(`✅ OpenAPI Spec (${spec.info?.title || 'unknown'} ${spec.info?.version || ''}) retrieved — ${schemaCount} schemas.`);

    const generated = generateTypesFromSchemas(schemas);
    for (const targetFile of TARGET_FILES) {
      const targetGenerated = formatForTarget(generated, targetFile);
      if (check) {
        if (!fs.existsSync(targetFile) || fs.readFileSync(targetFile, 'utf8') !== targetGenerated) {
          throw new Error(`Generated API types are stale: ${targetFile}`);
        }
        continue;
      }

      fs.writeFileSync(targetFile, targetGenerated, 'utf8');
      console.log(`✨ Generated TypeScript types → ${targetFile}`);
    }
  } catch (err) {
    console.error(`OpenAPI type synchronization failed: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
