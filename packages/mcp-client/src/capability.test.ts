import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CapabilityArgs, ToolContext } from '@cofold/agents';
import { createMcpClients } from './capability.js';
import type { ConnectOptions, McpConnection } from './connect.js';
import { effectsOf } from './effects.js';
import { expandServer } from './expand.js';
import { inputSchemaOf } from './input-schema.js';
import { toolNameOf } from './names.js';
import { outputOf } from './output.js';
import { serversOf } from './schema.js';
import type { McpCallResult, McpToolInfo } from './types.js';

const clientInfo = { name: 'test', version: '1' };
const args = { signal: new AbortController().signal } as unknown as CapabilityArgs;
const ctx = { signal: new AbortController().signal } as unknown as ToolContext;
const fixture = (name: string): string => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));

/** A connection whose tools and answers a test writes. */
function fake(tools: McpToolInfo[], answer: (tool: string, input: unknown) => McpCallResult = () => ({ content: [] })): McpConnection {
  return {
    name: 'fake', serverInfo: {}, instructions: undefined, closed: undefined,
    tools: () => tools,
    call: async (tool, input) => answer(tool, input),
    close: async () => {},
  };
}

describe('the capability', () => {
  it('gives each server\'s tools deferred, named mcp__<server>__<tool>, with effects from their hints', async () => {
    const clients = createMcpClients({
      servers: { 'my.files': { command: 'x' } },
      clientInfo,
      connect: async () => fake([
        { name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, annotations: { readOnlyHint: true } },
        { name: 'write', inputSchema: { type: 'object' } },
      ], (tool, input) => ({ content: [{ type: 'text', text: `${tool} ${JSON.stringify(input)}` }] })),
    });
    const capability = clients.capability();
    expect(capability.defer).toEqual({ over: 0 });
    const tools = await capability.tools!(args);
    expect(tools.map((tool) => tool.name)).toEqual(['mcp__my_files__read', 'mcp__my_files__write']);
    expect(tools[0]!.effects).toEqual({ reads: true });
    expect(tools[1]!.effects).toEqual({ writes: true, destructive: true, network: true });
    expect(tools[1]!.description).toBe('write, a tool of the my.files MCP server');
    expect(await tools[0]!.execute({ path: 'a' }, ctx)).toBe('read {"path":"a"}');
    expect(clients.status()).toEqual([{ name: 'my.files', state: 'connected', tools: 2 }]);
  });

  it('takes another id, and leaves out the servers it is told to', async () => {
    const clients = createMcpClients({ servers: { a: { command: 'x' }, b: { command: 'y' } }, clientInfo, connect: async (options) => fake([{ name: 't', description: options.name, inputSchema: { type: 'object' } }]) });
    const capability = clients.capability({ id: 'mcp-session', without: ['a'] });
    expect(capability.id).toBe('mcp-session');
    expect((await capability.tools!(args)).map((tool) => tool.name)).toEqual(['mcp__b__t']);
  });

  it('throws the text of an isError result, so the model sees a tool error', async () => {
    const clients = createMcpClients({ servers: { s: { command: 'x' } }, clientInfo, connect: async () => fake([{ name: 'go', description: 'Go', inputSchema: { type: 'object' } }], () => ({ content: [{ type: 'text', text: 'no such thing' }], isError: true })) });
    const [tool] = await clients.capability().tools!(args);
    await expect(tool!.execute({}, ctx)).rejects.toThrow('no such thing');
  });

  it('says a failing server once, lists no tools for it, and tries again at the next listing', async () => {
    const warned: string[] = [];
    let attempts = 0;
    const clients = createMcpClients({
      servers: { down: { command: 'x' }, up: { command: 'y' }, off: { command: 'z', enabled: false } },
      clientInfo,
      warn: (message) => warned.push(message),
      connect: async (options: ConnectOptions) => {
        if (options.name === 'down') { attempts += 1; throw new Error('connect ECONNREFUSED'); }
        return fake([{ name: 'ok', description: 'Ok', inputSchema: { type: 'object' } }]);
      },
    });
    const capability = clients.capability();
    expect((await capability.tools!(args)).map((tool) => tool.name)).toEqual(['mcp__up__ok']);
    expect((await capability.tools!(args)).map((tool) => tool.name)).toEqual(['mcp__up__ok']);
    expect(attempts).toBe(2);
    expect(warned).toEqual(['mcp server "down": connect ECONNREFUSED']);
    expect(clients.status().map((one) => one.state)).toEqual(['failed', 'connected', 'disabled']);
  });

  it('keeps the first of two tools with one name, and reads any input schema as an object', async () => {
    const warned: string[] = [];
    const clients = createMcpClients({
      servers: { s: { command: 'x' } },
      clientInfo,
      warn: (message) => warned.push(message),
      connect: async () => fake([
        { name: 'a.b', description: 'One', inputSchema: { type: 'object' } },
        { name: 'a_b', description: 'Two', inputSchema: { type: 'object' } },
        { name: 'list', description: 'Not an object', inputSchema: { type: 'array' } },
      ]),
    });
    const tools = await clients.capability().tools!(args);
    expect(tools.map((tool) => tool.description)).toEqual(['One', 'Not an object']);
    expect(warned).toEqual(['mcp server "s": tool a_b is named mcp__s__a_b, as another tool is; the first is kept']);
  });

  it('runs a real server\'s tool end to end, and closes it', async () => {
    const clients = createMcpClients({ servers: { raw: { command: process.execPath, args: [fixture('raw-server.mjs')] } }, clientInfo });
    try {
      const tools = await clients.capability().tools!(args);
      const add = tools.find((tool) => tool.name === 'mcp__raw__add')!;
      expect(add.effects).toEqual({ reads: true });
      expect(await add.execute({ a: 20, b: 22 }, ctx)).toBe('42');
      // `grow` takes a `$ref` into `$defs` with a `not`, which the harness refuses unreduced.
      expect(tools.find((tool) => tool.name === 'mcp__raw__grow')?.toModelDefinition().input).toEqual({ type: 'object', properties: { item: { type: 'string' } } });
    } finally {
      await clients.close();
    }
  });
});

describe('the parts', () => {
  it('cuts a long name and ends it in a hash, so two long names stay two', () => {
    const one = toolNameOf('server', `tool_${'x'.repeat(80)}_one`);
    const two = toolNameOf('server', `tool_${'x'.repeat(80)}_two`);
    expect(one).toHaveLength(64);
    expect(one).not.toBe(two);
    expect(toolNameOf('a b', 'c/d')).toBe('mcp__a_b__c_d');
  });

  it('reads hints by the spec\'s defaults', () => {
    expect(effectsOf(undefined)).toEqual({ writes: true, destructive: true, network: true });
    expect(effectsOf({ readOnlyHint: true, openWorldHint: true })).toEqual({ reads: true, network: true });
    expect(effectsOf({ destructiveHint: false, openWorldHint: false })).toEqual({ writes: true, destructive: false, network: false });
  });

  it('expands ${VAR} and ${VAR:-default}, and keeps an unset name as written', () => {
    const unset: string[] = [];
    const server = expandServer({ type: 'http', url: '${BASE:-https://x.example.com}/mcp', headers: { authorization: 'Bearer ${TOKEN}', other: '${NOPE}' } }, { TOKEN: 't' }, (name) => unset.push(name));
    expect(server).toEqual({ type: 'http', url: 'https://x.example.com/mcp', headers: { authorization: 'Bearer t', other: '${NOPE}' } });
    expect(unset).toEqual(['NOPE']);
    expect(expandServer({ command: '${BIN}', args: ['${A}'], env: { K: '${A}' } }, { BIN: 'node', A: '1' }, () => {})).toEqual({ command: 'node', args: ['1'], env: { K: '1' } });
  });

  it('gives a result\'s text, a resource, a link, media and structured content', () => {
    expect(outputOf({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: '', mimeType: 'image/png' }, { type: 'resource_link', uri: 'file:///x' }, { type: 'resource', resource: { uri: 'file:///y', text: 'y' } }] })).toBe('a\n[image]\nfile:///x\ny');
    expect(outputOf({ structuredContent: { n: 1 } })).toBe('{"n":1}');
  });

  it('reduces an input schema to what cofold validates', () => {
    expect(inputSchemaOf({
      type: 'object', $schema: 'x', additionalProperties: { type: 'string' }, propertyNames: { pattern: 'a' },
      properties: { a: { $ref: '#/definitions/A' }, b: { type: ['string', 'weird'], pattern: '(' }, c: { $ref: '#/$defs/Loop' } },
      definitions: { A: { type: 'integer', minimum: 1 } },
      $defs: { Loop: { type: 'object', properties: { next: { $ref: '#/$defs/Loop' } } } },
    })).toMatchObject({
      type: 'object',
      properties: { a: { type: 'integer', minimum: 1 }, b: { type: ['string'] }, c: { type: 'object' } },
    });
  });

  it('keeps a well formed server and says why another is left out', () => {
    const wrong: string[] = [];
    expect(serversOf({ a: { command: 'x' }, b: { type: 'http', url: 'http://h' }, c: { url: 'http://h' }, d: { command: 'x', extra: 1 }, e: 'no' }, (name, why) => wrong.push(`${name}: ${why}`)))
      .toEqual({ a: { command: 'x' }, b: { type: 'http', url: 'http://h' } });
    expect(wrong).toEqual(['c: a url needs "type": "http"', 'd: extra is not a key of this server type', 'e: not an object']);
  });
});
