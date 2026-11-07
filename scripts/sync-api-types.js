#!/usr/bin/env node
/**
 * TaskFlow OpenAPI to TypeScript Contract Synchronizer
 *
 * Reads the reviewed OpenAPI baseline (api/openapi.json, refreshed by `npm run api:spec:update`) and
 * generates, once, into the shared workspace package:
 * - shared/schemas/src/generated/api-types.ts: TypeScript interfaces for every schema. Both clients
 *   re-export them from their own `types/api.ts` (frontend/src/app/types, mobile/src/types).
 * - shared/schemas/src/generated/api-responses.ts: structural zod/mini contracts for the response
 *   DTOs. The hand-written response schemas stay the runtime validators (they add enums, lengths,
 *   defaults); a parity test compares their fields with these, so a response field added by the
 *   backend cannot be silently stripped by a validator.
 *
 * The response DTOs are the schemas reachable from any operation's 2xx response, so a new endpoint
 * needs no list to be edited here.
 *
 * Usage: node scripts/sync-api-types.js [--check] [openapi_file]
 *
 * Only a local file is accepted: generating from a live server would write unreviewed network data
 * into committed sources (CodeQL js/http-to-file-access).
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SPEC = path.resolve(__dirname, '../api/openapi.json');
const TYPES_FILE = path.resolve(__dirname, '../shared/schemas/src/generated/api-types.ts');
const RESPONSE_CONTRACT_FILE = path.resolve(__dirname, '../shared/schemas/src/generated/api-responses.ts');

/**
 * Framework types some endpoints return (the CSRF token, the SSE emitter). They are not DTOs the
 * clients parse, so they get neither a contract nor the "every field is present" rule.
 */
const FRAMEWORK_SCHEMAS = new Set(['CsrfToken', 'SseEmitter']);

/** Response DTOs: component schemas reachable from any operation's 2xx response bodies. */
function responseSchemaNames(spec) {
  const schemas = spec.components.schemas;
  const names = new Set();
  const queue = [];
  for (const operations of Object.values(spec.paths || {})) {
    for (const operation of Object.values(operations)) {
      for (const [code, response] of Object.entries(operation.responses || {})) {
        if (!code.startsWith('2')) continue;
        for (const media of Object.values(response.content || {})) queue.push(media.schema);
      }
    }
  }
  while (queue.length > 0) {
    const schema = queue.pop();
    if (!schema) continue;
    if (schema.$ref) {
      const name = schema.$ref.split('/').pop();
      if (!FRAMEWORK_SCHEMAS.has(name) && !names.has(name) && schemas[name]) {
        names.add(name);
        queue.push(schemas[name]);
      }
      continue;
    }
    if (schema.items) queue.push(schema.items);
    Object.values(schema.properties || {}).forEach((property) => queue.push(property));
  }
  return names;
}

// ---------------------------------------------------------------------------
// JSON Schema → TypeScript type mapping
// ---------------------------------------------------------------------------
// Response DTO fields are all typed as present: the hand-written validators turn an omitted
// nullable field into its empty value ("omitted means empty"), and the apps use the parsed value.
let RESPONSE_SCHEMAS = new Set();

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
    "{\n  accessToken: string;\n  expiresIn: number;\n  refreshToken?: string;\n  role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER';\n  tokenType: 'Bearer';\n  username: string;\n}",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function loadOpenApiSpec(source) {
  if (/^https?:\/\//i.test(source)) {
    throw new Error('Pass the OpenAPI baseline file; refresh it from a running backend with npm run api:spec:update.');
  }
  return JSON.parse(fs.readFileSync(source, 'utf8'));
}

function generateTypesFromSchemas(schemas) {
  const lines = [];

  lines.push('/**');
  lines.push(' * API DTO types of TaskFlow, generated from the reviewed baseline api/openapi.json.');
  lines.push(' * Both clients re-export them from their own types/api.ts.');
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

// Which fields can be absent comes from the spec: the backend marks every response record component
// `required` unless it is annotated @Nullable (OpenApiResponseNullabilityConfig), because Jackson
// omits null fields from every response.

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

function generateResponseContracts(schemas, responseNames) {
  const used = new Set();
  const blocks = new Map();
  const order = [];

  const visit = (name) => {
    if (blocks.has(name) || !schemas[name]) return;
    blocks.set(name, null); // cycle guard
    const schema = schemas[name];
    const deps = new Set();
    if (!Array.isArray(schema.required)) {
      throw new Error(
        `Response schema ${name} has no "required" list. Make it a record (or mark its fields with ` +
          '@Schema(requiredMode = REQUIRED)) so the spec says which fields are always present.',
      );
    }
    const required = new Set(schema.required);
    const fields = Object.entries(schema.properties || {}).map(([key, prop]) => {
      let expression = zodExpression(prop, used, deps);
      // Jackson omits null fields, so a property the spec does not list as required may be absent.
      const optionalField = !required.has(key);
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
  [...responseNames].sort().forEach(visit);

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

/** shared/schemas quotes strings with double quotes, like the rest of the package. */
function toDoubleQuotes(generated) {
  return generated.replace(/'([^']*)'/g, '"$1"');
}

function writeOrCheck(file, content, check, label) {
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
      throw new Error(`${label} are stale: ${file}`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  console.log(`✨ ${label} → ${file}`);
}

async function main() {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  const source = args.find((arg) => arg !== '--check') || DEFAULT_SPEC;
  console.log(`Loading OpenAPI spec from ${source} ...`);

  try {
    const spec = loadOpenApiSpec(source);

    if (!spec.components || !spec.components.schemas) {
      throw new Error('Invalid OpenAPI document: missing components.schemas');
    }

    const schemas = spec.components.schemas;
    const schemaCount = Object.keys(schemas).length;
    console.log(`✅ OpenAPI Spec (${spec.info?.title || 'unknown'} ${spec.info?.version || ''}) retrieved — ${schemaCount} schemas.`);

    RESPONSE_SCHEMAS = responseSchemaNames(spec);
    writeOrCheck(TYPES_FILE, toDoubleQuotes(generateTypesFromSchemas(schemas)), check, 'Generated API types');
    writeOrCheck(RESPONSE_CONTRACT_FILE, generateResponseContracts(schemas, RESPONSE_SCHEMAS), check,
      'Generated response contracts');
  } catch (err) {
    const rawMessage = err && err.message ? String(err.message) : String(err);
    const safeMessage = rawMessage.replace(/\n|\r/g, '');
    console.error(`OpenAPI type synchronization failed: ${safeMessage}`);
    process.exitCode = 1;
  }
}

main();
