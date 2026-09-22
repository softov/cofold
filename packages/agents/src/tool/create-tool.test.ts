import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors.js';
import type { JsonSchema } from '@doopx/sdk';
import { createTool } from './create-tool.js';

const input: JsonSchema = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as AgentError).code;
  }
}

describe('createTool', () => {
  it('builds a frozen tool with defaults filled', () => {
    const echo = createTool<{ text: string }>({
      name: 'echo',
      description: 'Return the text unchanged',
      input,
      execute: (i) => i.text,
    });
    expect(Object.isFrozen(echo)).toBe(true);
    expect(echo.effects).toEqual({});
    expect(echo.source).toBe('agent');
    expect(echo.toModelDefinition()).toEqual({ name: 'echo', description: 'Return the text unchanged', input });
    expect(Object.keys(echo.toModelDefinition())).toEqual(['name', 'description', 'input']);
  });

  it('keeps declared effects', () => {
    const t = createTool({ name: 'rm', description: 'x', input, effects: { destructive: true }, execute: () => '' });
    expect(t.effects).toEqual({ destructive: true });
  });

  it('rejects a name outside the pattern', () => {
    expect(code(() => createTool({ name: 'bad name', description: 'x', input, execute: () => '' }))).toBe('invalid_options');
    expect(code(() => createTool({ name: '', description: 'x', input, execute: () => '' }))).toBe('invalid_options');
  });

  it('rejects an empty description', () => {
    expect(code(() => createTool({ name: 'ok', description: '   ', input, execute: () => '' }))).toBe('invalid_options');
  });

  it('rejects a non-object input schema', () => {
    expect(code(() => createTool({ name: 'ok', description: 'x', input: { type: 'string' }, execute: () => '' }))).toBe('invalid_options');
  });

  it('rejects invalid schema values at creation time, naming the path', () => {
    const bad = (input: unknown) => () => createTool({ name: 'ok', description: 'x', input: input as JsonSchema, execute: () => '' });
    expect(bad({ type: 'object', properties: { a: { type: 'string', pattern: '(' } } })).toThrow('$.a: pattern does not compile');
    expect(bad({ type: 'object', properties: { a: { type: 'str' } } })).toThrow('$.a: unknown type "str"');
  });

  it('rejects unsupported schema keywords at creation time', () => {
    const withRef = { type: 'object', properties: { a: { $ref: '#/x' } } } as unknown as JsonSchema;
    expect(() => createTool({ name: 'ok', description: 'x', input: withRef, execute: () => '' })).toThrow('$.a uses $ref');
  });
});
