#!/usr/bin/env node
/**
 * TaskFlow OpenAPI to TypeScript Contract Synchronizer
 *
 * Fetches the backend OpenAPI spec (GET /v3/api-docs) and generates
 * TypeScript interface definitions in both platform clients, plus structural zod/mini schemas
 * for the response DTOs (shared/schemas/src/generated/api-responses.ts). The hand-written
 * response schemas stay the runtime validators (they add enums, lengths, defaults); a parity
 * test compares their fields with the generated ones, so a response field added by the backend
 * cannot be silently stripped by a validator.
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
const RESPONSE_CONTRACT_FILE = path.resolve(__dirname, '../shared/schemas/src/generated/api-responses.ts');

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
  'PagedModelAppointmentResponse',
  'PageMetadata',
  'PublicBarberResponse',
  'RegisterResponse',
  'ServiceItemResponse',
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
  AppointmentPage: 'PagedModelAppointmentResponse',
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

// ---------------------------------------------------------------------------
// JSON Schema → zod/mini response contracts
// ---------------------------------------------------------------------------
// Response DTOs that get a generated contract: the TypeScript response set plus ShopInfoResponse.
const ZOD_RESPONSE_SCHEMAS = [...RESPONSE_SCHEMAS, 'ShopInfoResponse'].sort();

// Fields the backend leaves out of the JSON when null (Jackson NON_NULL). OpenAPI does not say so
// (springdoc emits no `required` list for these DTOs), so they are listed here and generated as
// optional. The hand-written validators read them as "" (omittedAsEmptyString).
const OMITTED_WHEN_NULL = {
  BarberResponse: ['email', 'phone'],
  BarberTimeOffResponse: ['reason'],
  NotificationOutboxResponse: ['sentAt', 'type'],
  ServiceItemResponse: ['description'],
};

const lowerFirst = (name) => name.charAt(0).toLowerCase() + name.slice(1);
const contractName = (schemaName) => `${lowerFirst(schemaName)}Contract`;

function zodExpression(schema, used, deps) {
  if (!schema) { used.add('unknown'); return 'unknown()'; }
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop();
    deps.add(refName);
    return contractName(refName);
  }
  if (schema.enum) {
    used.add('zEnum');
    return `zEnum([${schema.enum.map((value) => JSON.stringify(value)).join(', ')}])`;
  }
  switch (schema.type) {
    case 'string': used.add('string'); return 'string()';
    case 'integer':
    case 'number': used.add('number'); return 'number()';
    case 'boolean': used.add('boolean'); return 'boolean()';
    case 'array': used.add('array'); return `array(${zodExpression(schema.items, used, deps)})`;
    default: used.add('unknown'); return 'unknown()';
  }
}

function generateResponseContracts(schemas) {
  const used = new Set();
  const blocks = new Map();
  const order = [];

  const visit = (name) => {
    if (blocks.has(name) || !schemas[name]) return;
    blocks.set(name, null); // cycle guard
    const schema = schemas[name];
    const deps = new Set();
    const omitted = new Set(OMITTED_WHEN_NULL[name] || []);
    const fields = Object.entries(schema.properties || {}).map(([key, prop]) => {
      let expression = zodExpression(prop, used, deps);
      // Every response property is present unless it is listed as omitted-when-null, or the
      // schema itself marks it optional (a `required` list that does not include it).
      const optionalField = omitted.has(key) || (schema.required && !schema.required.includes(key));
      if (optionalField) { used.add('optional'); expression = `optional(${expression})`; }
      const field = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      return `  ${field}: ${expression},`;
    });
    deps.forEach(visit);
    used.add('object');
    const doc = schema.description ? `/** ${schema.description} */\n` : '';
    blocks.set(name, `${doc}export const ${contractName(name)} = object({\n${fields.join('\n')}\n});\n`);
    order.push(name);
  };
  ZOD_RESPONSE_SCHEMAS.forEach(visit);

  const importNames = ['array', 'boolean', 'number', 'object', 'optional', 'string', 'unknown', 'zEnum']
    .filter((n) => used.has(n))
    .map((n) => (n === 'zEnum' ? 'enum as zEnum' : n));

  return [
    '/**',
    ' * Structural response contracts generated from api/openapi.json.',
    ' *',
    ' * These describe which fields the backend sends and their primitive types. They are NOT the',
    ' * runtime validators: the hand-written schemas next to this folder add enums, lengths and',
    ' * defaults, and a parity test fails when their field sets differ from these.',
    ' *',
    ' * DO NOT EDIT MANUALLY — run `npm run sync:api-types` to regenerate.',
    ' */',
    `import { ${importNames.join(', ')} } from "zod/mini";`,
    '',
    ...order.map((name) => blocks.get(name)),
  ].join('\n').replace(/\n+$/, '\n');
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

    const contracts = generateResponseContracts(schemas);
    if (check) {
      if (!fs.existsSync(RESPONSE_CONTRACT_FILE) || fs.readFileSync(RESPONSE_CONTRACT_FILE, 'utf8') !== contracts) {
        throw new Error(`Generated response contracts are stale: ${RESPONSE_CONTRACT_FILE}`);
      }
    } else {
      fs.mkdirSync(path.dirname(RESPONSE_CONTRACT_FILE), { recursive: true });
      fs.writeFileSync(RESPONSE_CONTRACT_FILE, contracts, 'utf8');
      console.log(`✨ Generated response contracts → ${RESPONSE_CONTRACT_FILE}`);
    }
  } catch (err) {
    const rawMessage = err && err.message ? String(err.message) : String(err);
    const safeMessage = rawMessage.replace(/\n|\r/g, '');
    console.error(`OpenAPI type synchronization failed: ${safeMessage}`);
    process.exitCode = 1;
  }
}

main();
