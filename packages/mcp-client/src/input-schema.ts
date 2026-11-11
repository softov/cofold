import type { JsonSchema } from '@cofold/agents';

/** The keywords cofold's validator holds a value to; any other is dropped. */
const KEPT = new Set([
  'type', 'description', 'properties', 'required', 'items', 'enum', 'const', 'default', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'minItems',
  'maxItems', 'uniqueItems', 'prefixItems', 'anyOf', 'oneOf', 'allOf', 'nullable', 'title', 'examples',
]);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']);
/** How deep a `$ref` is followed before it is read as any value. */
const MAX_REF_DEPTH = 8;

/**
 * A server's input schema in the subset cofold validates, since the harness refuses a keyword it does not
 * enforce. A `$ref` into `$defs` or `definitions` is inlined; `additionalProperties` stays only as a boolean; any
 * other keyword, a type it does not know, and a pattern that does not compile are dropped. The server still
 * validates its own input, as the spec requires, so a dropped rule is enforced there.
 */
export function inputSchemaOf(schema: Record<string, unknown>): JsonSchema {
  const defs = { ...(record(schema['definitions']) ?? {}), ...(record(schema['$defs']) ?? {}) };
  const reduced = reduce(schema, defs, 0);
  return { ...reduced, type: 'object' } as JsonSchema;
}

function reduce(schema: unknown, defs: Record<string, unknown>, depth: number): Record<string, unknown> {
  const held = record(schema);
  if (held === undefined) return {};
  const ref = held['$ref'];
  if (typeof ref === 'string') {
    const target = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)?.[1];
    if (target === undefined || depth >= MAX_REF_DEPTH || defs[target] === undefined) return {};
    return reduce(defs[target], defs, depth + 1);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(held)) {
    if (key === 'additionalProperties') { if (typeof value === 'boolean') out[key] = value; continue; }
    if (!KEPT.has(key)) continue;
    if (key === 'properties') {
      const properties = record(value) ?? {};
      out[key] = Object.fromEntries(Object.entries(properties).map(([name, sub]) => [name, reduce(sub, defs, depth)]));
    } else if (key === 'items') {
      out[key] = reduce(value, defs, depth);
    } else if (key === 'anyOf' || key === 'oneOf' || key === 'allOf' || key === 'prefixItems') {
      if (Array.isArray(value)) out[key] = value.map((sub) => reduce(sub, defs, depth));
    } else if (key === 'type') {
      const types = (Array.isArray(value) ? value : [value]).filter((one) => typeof one === 'string' && TYPES.has(one));
      if (types.length > 0) out[key] = Array.isArray(value) ? types : types[0];
    } else if (key === 'pattern') {
      if (typeof value === 'string' && compiles(value)) out[key] = value;
    } else if (key === 'required' || key === 'enum') {
      if (Array.isArray(value)) out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function compiles(pattern: string): boolean {
  try { new RegExp(pattern, 'u'); return true; } catch { return false; }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
