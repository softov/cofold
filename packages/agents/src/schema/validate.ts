import { SchemaError } from '../errors.js';
import type { JsonSchema, SchemaIssue, SchemaResult } from '@facio/sdk';

/** Keywords of the supported subset; `title`, `examples`, `$schema` are accepted and ignored. */
export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set(Object.keys({
  type: 0, description: 0, properties: 0, required: 0, additionalProperties: 0, items: 0, enum: 0, const: 0,
  default: 0, minimum: 0, maximum: 0, exclusiveMinimum: 0, exclusiveMaximum: 0, multipleOf: 0,
  minLength: 0, maxLength: 0, pattern: 0, format: 0, minItems: 0, maxItems: 0, uniqueItems: 0, prefixItems: 0,
  anyOf: 0, oneOf: 0, allOf: 0, nullable: 0, title: 0, examples: 0, $schema: 0,
} satisfies Record<string, 0>));

const TYPES: ReadonlySet<string> = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']);

/**
 * Throws SchemaError('unsupported_keyword' | 'invalid_schema'). Called at createTool time, so that
 * validateSchema never throws on a model-supplied argument (a bad `pattern` would otherwise surface
 * as a raw SyntaxError inside the loop).
 */
export function assertSupportedSchema(args: { schema: JsonSchema; path?: string }): void {
  const path = args.path ?? '$';
  const schema = args.schema as Record<string, unknown>;
  const invalid = (message: string) => new SchemaError({ code: 'invalid_schema', message: `${path}: ${message}` });
  if (!isPlainObject(schema)) throw invalid('schema must be an object');
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new SchemaError({ code: 'unsupported_keyword', message: `${path}: unsupported keyword "${key}"` });
    }
  }
  const { type, pattern, properties, items } = schema;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    for (const t of types) {
      if (typeof t !== 'string' || !TYPES.has(t)) throw invalid(`unknown type ${JSON.stringify(t)}`);
    }
  }
  if (pattern !== undefined) {
    if (typeof pattern !== 'string') throw invalid('pattern must be a string');
    try { new RegExp(pattern); } catch (e) { throw invalid(`pattern does not compile: ${(e as Error).message}`); }
  }
  for (const key of ['required', 'enum', 'anyOf', 'oneOf'] as const) {
    if (schema[key] !== undefined && !Array.isArray(schema[key])) throw invalid(`${key} must be an array`);
  }
  if (properties !== undefined) {
    if (!isPlainObject(properties)) throw invalid('properties must be an object');
    for (const [name, sub] of Object.entries(properties)) {
      assertSupportedSchema({ schema: sub as JsonSchema, path: `${path}.${name}` });
    }
  }
  if (items !== undefined) assertSupportedSchema({ schema: items as JsonSchema, path: `${path}[]` });
  (args.schema.prefixItems ?? []).forEach((sub, i) => assertSupportedSchema({ schema: sub, path: `${path}[${i}]` }));
  for (const alt of [...(args.schema.anyOf ?? []), ...(args.schema.oneOf ?? []), ...(args.schema.allOf ?? [])]) {
    assertSupportedSchema({ schema: alt, path });
  }
}

export function validateSchema<T = unknown>(args: { schema: JsonSchema; value: unknown }): SchemaResult<T> {
  const issues: SchemaIssue[] = [];
  const value = check(args.schema, args.value, '$', issues);
  return issues.length === 0 ? { ok: true, value: value as T } : { ok: false, issues };
}

function check(schema: JsonSchema, value: unknown, path: string, issues: SchemaIssue[]): unknown {
  // Absent is not a type error: `required` decides presence, this only fills the default.
  if (value === undefined) return schema.default !== undefined ? structuredClone(schema.default) : undefined;
  if (value === null && (schema.nullable || typeOk(schema, null))) return null;
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    issues.push({ path, message: `must equal ${JSON.stringify(schema.const)}` }); return value;
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    issues.push({ path, message: `must be one of ${JSON.stringify(schema.enum)}` }); return value;
  }
  if (schema.anyOf) {
    const hit = schema.anyOf.some((alt) => validateSchema({ schema: alt, value }).ok);
    if (!hit) issues.push({ path, message: 'matches none of anyOf' });
    return value;
  }
  if (schema.oneOf) {
    const hits = schema.oneOf.filter((alt) => validateSchema({ schema: alt, value }).ok).length;
    if (hits !== 1) issues.push({ path, message: `matches ${hits} of oneOf, expected 1` });
    return value;
  }
  if (schema.allOf) {
    for (const alt of schema.allOf) check(alt, value, path, issues);
    return value;
  }
  if (schema.type && !typeOk(schema, value)) {
    issues.push({ path, message: `expected ${String(schema.type)}, got ${describe(value)}` }); return value;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push({ path, message: `shorter than ${schema.minLength}` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push({ path, message: `longer than ${schema.maxLength}` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push({ path, message: `does not match /${schema.pattern}/` });
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) issues.push({ path, message: 'not an ISO-8601 timestamp' });
    return value;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, message: `less than ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, message: `greater than ${schema.maximum}` });
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) issues.push({ path, message: `not greater than ${schema.exclusiveMinimum}` });
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) issues.push({ path, message: `not less than ${schema.exclusiveMaximum}` });
    if (schema.multipleOf !== undefined && !isMultiple(value, schema.multipleOf)) issues.push({ path, message: `not a multiple of ${schema.multipleOf}` });
    return value;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path, message: `fewer than ${schema.minItems} items` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path, message: `more than ${schema.maxItems} items` });
    if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) issues.push({ path, message: 'items are not unique' });
    const prefix = schema.prefixItems ?? [];
    const items = schema.items;
    if (!items && prefix.length === 0) return value;
    return value.map((v, i) => { const sub = prefix[i] ?? items; return sub ? check(sub, v, `${path}[${i}]`, issues) : v; });
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (value[key] === undefined && props[key]?.default === undefined) issues.push({ path: `${path}.${key}`, message: 'required' });
    }
    for (const [key, sub] of Object.entries(props)) {
      const v = check(sub, value[key], `${path}.${key}`, issues);
      if (v !== undefined) out[key] = v;
    }
    for (const key of Object.keys(value)) {
      if (key in props) continue;
      if (schema.additionalProperties === false) issues.push({ path: `${path}.${key}`, message: 'unexpected property' });
      else out[key] = value[key];
    }
    return out;
  }
  return value;
}

/** `multipleOf` without the floating-point lie: 0.3 is a multiple of 0.1. */
function isMultiple(value: number, step: number): boolean {
  const quotient = value / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function typeOk(schema: JsonSchema, value: unknown): boolean {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length === 0) return true;
  return types.some((t) => {
    switch (t) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number' && Number.isFinite(value);
      case 'integer': return typeof value === 'number' && Number.isInteger(value);
      case 'boolean': return typeof value === 'boolean';
      case 'null': return value === null;
      case 'object': return isPlainObject(value);
      case 'array': return Array.isArray(value);
    }
  });
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function describe(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
