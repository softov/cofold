import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '@facio/sdk';
import { assertSupportedSchema, validateSchema } from './json-schema.js';

const user: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 0 },
    role: { type: 'string', enum: ['admin', 'member'], default: 'member' },
  },
  required: ['name', 'age'],
  additionalProperties: false,
};

describe('validateSchema', () => {
  it('reports a missing required property', () => {
    const r = validateSchema({ schema: user, value: { age: 3 } });
    expect(r).toEqual({ ok: false, issues: [{ path: '$.name', message: 'required' }] });
  });

  it('never coerces types', () => {
    const r = validateSchema({ schema: user, value: { name: 'a', age: '3' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toEqual({ path: '$.age', message: 'expected integer, got string' });
  });

  it('applies defaults for missing optional properties', () => {
    const r = validateSchema<{ role: string }>({ schema: user, value: { name: 'a', age: 3 } });
    expect(r).toEqual({ ok: true, value: { name: 'a', age: 3, role: 'member' } });
  });

  it('accepts an absent optional property without a default and omits it from the value', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] };
    expect(validateSchema({ schema, value: { a: 'x' } })).toEqual({ ok: true, value: { a: 'x' } });
  });

  it('rejects unexpected properties when additionalProperties is false', () => {
    const r = validateSchema({ schema: user, value: { name: 'a', age: 3, extra: 1 } });
    expect(r).toEqual({ ok: false, issues: [{ path: '$.extra', message: 'unexpected property' }] });
  });

  it('keeps unexpected properties when additionalProperties is not false', () => {
    const r = validateSchema({ schema: { type: 'object', properties: {} }, value: { extra: 1 } });
    expect(r).toEqual({ ok: true, value: { extra: 1 } });
  });

  it('reports nested paths', () => {
    const schema: JsonSchema = { type: 'object', properties: { user } };
    const r = validateSchema({ schema, value: { user: { name: 'a', age: -1 } } });
    expect(r).toEqual({ ok: false, issues: [{ path: '$.user.age', message: 'less than 0' }] });
  });

  it('validates array items with an index path', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'number' }, maxItems: 3 };
    expect(validateSchema({ schema, value: [1, 2] })).toEqual({ ok: true, value: [1, 2] });
    const r = validateSchema({ schema, value: [1, 'x'] });
    expect(r).toEqual({ ok: false, issues: [{ path: '$[1]', message: 'expected number, got string' }] });
    expect(validateSchema({ schema, value: [1, 2, 3, 4] }).ok).toBe(false);
  });

  it('checks enum and const', () => {
    expect(validateSchema({ schema: { enum: ['a', 'b'] }, value: 'c' }).ok).toBe(false);
    expect(validateSchema({ schema: { enum: ['a', 'b'] }, value: 'a' }).ok).toBe(true);
    expect(validateSchema({ schema: { const: 42 }, value: 41 }).ok).toBe(false);
    expect(validateSchema({ schema: { const: { k: 1 } }, value: { k: 1 } }).ok).toBe(true);
  });

  it('counts anyOf and oneOf matches', () => {
    const alts: JsonSchema[] = [{ type: 'string' }, { type: 'number' }, { type: 'integer' }];
    expect(validateSchema({ schema: { anyOf: alts }, value: 3 }).ok).toBe(true);
    expect(validateSchema({ schema: { anyOf: alts }, value: true }).ok).toBe(false);
    expect(validateSchema({ schema: { oneOf: alts }, value: 'x' }).ok).toBe(true);
    const r = validateSchema({ schema: { oneOf: alts }, value: 3 });
    expect(r).toEqual({ ok: false, issues: [{ path: '$', message: 'matches 2 of oneOf, expected 1' }] });
  });

  it('accepts null for nullable and for a null type', () => {
    expect(validateSchema({ schema: { type: 'string', nullable: true }, value: null })).toEqual({ ok: true, value: null });
    expect(validateSchema({ schema: { type: ['string', 'null'] }, value: null })).toEqual({ ok: true, value: null });
    expect(validateSchema({ schema: { type: 'string' }, value: null }).ok).toBe(false);
  });

  it('checks string and number bounds', () => {
    expect(validateSchema({ schema: { type: 'string', pattern: '^[a-z]+$' }, value: 'A1' }).ok).toBe(false);
    expect(validateSchema({ schema: { type: 'string', maxLength: 2 }, value: 'abc' }).ok).toBe(false);
    expect(validateSchema({ schema: { type: 'number', maximum: 1 }, value: 2 }).ok).toBe(false);
    expect(validateSchema({ schema: { type: 'integer' }, value: 1.5 }).ok).toBe(false);
  });
});

describe('assertSupportedSchema', () => {
  it('accepts the supported subset', () => {
    expect(() => assertSupportedSchema({ schema: user })).not.toThrow();
  });

  it('refuses $ref and patternProperties, naming the path', () => {
    const withRef = { type: 'object', properties: { a: { $ref: '#/x' } } } as unknown as JsonSchema;
    expect(() => assertSupportedSchema({ schema: withRef })).toThrow('$.a uses $ref, which facio does not enforce and will not advertise');
    const withPattern = { type: 'object', patternProperties: {} } as unknown as JsonSchema;
    expect(() => assertSupportedSchema({ schema: withPattern })).toThrow(/uses patternProperties/);
  });

  it('refuses bad values so validateSchema never throws later', () => {
    const invalid = (schema: unknown): string => {
      try {
        assertSupportedSchema({ schema: schema as JsonSchema });
        return 'no error';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(invalid({ type: 'string', pattern: '(' })).toMatch(/^\$: pattern does not compile/);
    expect(invalid({ type: 'str' })).toBe('$: unknown type "str"');
    expect(invalid({ type: ['string', 'nope'] })).toBe('$: unknown type "nope"');
    expect(invalid({ type: 'object', required: 'name' })).toBe('$: required must be an array');
    expect(invalid({ enum: 'a' })).toBe('$: enum must be an array');
    expect(invalid({ type: 'object', properties: [] })).toBe('$: properties must be an object');
    expect(invalid({ type: 'object', properties: { a: { type: 'string', pattern: '[' } } })).toMatch(/^\$\.a: pattern/);
    expect(invalid({ type: 'array', items: 'string' })).toBe('$[]: schema must be an object');
  });

  it('walks items, anyOf and oneOf', () => {
    const bad = { $comment: 'x' } as unknown as JsonSchema;
    expect(() => assertSupportedSchema({ schema: { type: 'array', items: bad } })).toThrow(/^\$\[\] uses \$comment/);
    expect(() => assertSupportedSchema({ schema: { anyOf: [bad] } })).toThrow();
    expect(() => assertSupportedSchema({ schema: { oneOf: [bad] } })).toThrow();
  });
});

describe('the keywords the shared JsonSchema carries', () => {
  it('holds numbers to exclusive bounds and a step', () => {
    expect(validateSchema({ schema: { type: 'number', exclusiveMaximum: 5 }, value: 5 }).ok).toBe(false);
    expect(validateSchema({ schema: { type: 'number', multipleOf: 0.1 }, value: 0.3 }).ok).toBe(true);
    expect(validateSchema({ schema: { type: 'number', multipleOf: 0.1 }, value: 0.35 }).ok).toBe(false);
  });
  it('holds lists to uniqueness and a prefix, and strings to date-time', () => {
    expect(validateSchema({ schema: { type: 'array', uniqueItems: true }, value: [1, 1] }).ok).toBe(false);
    const tuple = { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }] } as const;
    expect(validateSchema({ schema: tuple, value: ['a', 1] }).ok).toBe(true);
    expect(validateSchema({ schema: tuple, value: ['a', 'b'] }).ok).toBe(false);
    expect(validateSchema({ schema: { type: 'string', format: 'date-time' }, value: 'yesterday' }).ok).toBe(false);
  });
  it('holds a value to allOf', () => {
    const both = { allOf: [{ type: 'string', minLength: 2 }, { type: 'string', maxLength: 3 }] } as const;
    expect(validateSchema({ schema: both, value: 'ab' }).ok).toBe(true);
    expect(validateSchema({ schema: both, value: 'abcd' }).ok).toBe(false);
    expect(() => assertSupportedSchema({ schema: both })).not.toThrow();
  });
});
