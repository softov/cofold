import { SchemaError } from '../errors.js';
import type { JsonSchema, SchemaIssue, ValidationResult } from '../types/schema.js';

/** Keywords of the supported subset; `title`, `examples`, `$schema` are accepted and ignored. */
export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set(Object.keys({
  type: 0, description: 0, properties: 0, required: 0, additionalProperties: 0, items: 0, enum: 0, const: 0,
  default: 0, minimum: 0, maximum: 0, minLength: 0, maxLength: 0, pattern: 0, minItems: 0, maxItems: 0,
  anyOf: 0, oneOf: 0, nullable: 0, title: 0, examples: 0, $schema: 0,
} satisfies Record<string, 0>));

/** Throws SchemaError('unsupported_keyword' | 'invalid_schema'). Called at createTool time. */
export function assertSupportedSchema(args: { schema: JsonSchema; path?: string }): void {
  const path = args.path ?? '$';
  for (const key of Object.keys(args.schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new SchemaError({ code: 'unsupported_keyword', message: `${path}: unsupported keyword "${key}"` });
    }
  }
  if (args.schema.type === 'object' || args.schema.properties) {
    for (const [name, sub] of Object.entries(args.schema.properties ?? {})) {
      assertSupportedSchema({ schema: sub, path: `${path}.${name}` });
    }
  }
  if (args.schema.items) assertSupportedSchema({ schema: args.schema.items, path: `${path}[]` });
  for (const alt of [...(args.schema.anyOf ?? []), ...(args.schema.oneOf ?? [])]) {
    assertSupportedSchema({ schema: alt, path });
  }
}

export function validateSchema<T = unknown>(args: { schema: JsonSchema; value: unknown }): ValidationResult<T> {
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
  if (schema.type && !typeOk(schema, value)) {
    issues.push({ path, message: `expected ${String(schema.type)}, got ${describe(value)}` }); return value;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push({ path, message: `shorter than ${schema.minLength}` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push({ path, message: `longer than ${schema.maxLength}` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push({ path, message: `does not match /${schema.pattern}/` });
    return value;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, message: `less than ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, message: `greater than ${schema.maximum}` });
    return value;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path, message: `fewer than ${schema.minItems} items` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path, message: `more than ${schema.maxItems} items` });
    const items = schema.items;
    return items ? value.map((v, i) => check(items, v, `${path}[${i}]`, issues)) : value;
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
