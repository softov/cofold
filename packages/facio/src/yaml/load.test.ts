import { describe, expect, it } from "vitest";
import { loadYaml } from "./load.js";

describe("YAML document references", () => {
  const files: Record<string, string> = {
    "/doc/api.yaml": 'paths:\n  /pets: { $ref: "paths/pets.yaml" }\ncopy: { $ref: "paths/pets.yaml#/get" }\n',
    "/doc/paths/pets.yaml": 'get:\n  schema: { $ref: "../types.json#/a~1b/~0name" }\n',
    "/doc/types.json": '{"a/b":{"~name":{"type":"string"}}}',
  };
  it("resolves local YAML/JSON and JSON pointers from each containing file and caches reads", async () => {
    const reads: string[] = [];
    const result = await loadYaml('/doc/api.yaml', { refs: { local: true }, readFile: (path) => {
      reads.push(path); if (!files[path]) throw new Error('missing'); return files[path]!;
    } });
    expect(result.data).toEqual({ paths: { '/pets': { get: { schema: { type: 'string' } } } }, copy: { schema: { type: 'string' } } });
    expect(reads).toHaveLength(3);
  });
  it("resolves remote references without sending API credentials", async () => {
    const seen: string[] = [];
    const result = await loadYaml('https://spec.test/api.yaml', { refs: { remote: true }, fetch: (async (url, init) => {
      seen.push(String(url)); expect(init?.headers).toBeUndefined(); expect(init?.redirect).toBe('error');
      return new Response(String(url).endsWith('api.yaml') ? 'value: { $ref: "types.json#/type" }' : '{"type":{"kind":"example"}}');
    }) as typeof fetch });
    expect(result.data).toEqual({ value: { kind: 'example' } });
    expect(seen).toEqual(['https://spec.test/api.yaml', 'https://spec.test/types.json']);
  });
  it("never lets a remote reference read a local file", async () => {
    await expect(loadYaml('https://spec.test/api.yaml', { refs: { remote: true, local: true }, fetch: (async () => new Response('$ref: file:///etc/passwd')) as typeof fetch }))
      .rejects.toThrow('Local reference is not allowed');
  });
  it("keeps refs inert unless requested and reports unresolved refs explicitly", async () => {
    expect((await loadYaml('/doc/api.yaml', { readFile: () => '$ref: missing.yaml' })).data).toEqual({ $ref: 'missing.yaml' });
    const result = await loadYaml('/doc/api.yaml', { refs: { local: true, unresolved: 'preserve' }, readFile: (path) => {
      if (path === '/doc/api.yaml') return '$ref: missing.yaml'; throw new Error('not found');
    } });
    expect(result.diagnostics).toEqual([{ reference: 'file:///doc/missing.yaml', message: 'not found' }]);
  });
  it("bounds cycles, document count, and response bytes", async () => {
    await expect(loadYaml('/doc/api.yaml', { refs: { local: true }, readFile: () => '$ref: "#"' })).rejects.toThrow('Circular');
    const kept = await loadYaml('/doc/api.yaml', { refs: { local: true, circular: 'preserve' }, readFile: () => '$ref: "#"' });
    expect(kept.data).toHaveProperty('$ref');
    await expect(loadYaml('/doc/api.yaml', { refs: { local: true }, maxDocuments: 1, readFile: () => '$ref: other.yaml' })).rejects.toThrow('maxDocuments');
    await expect(loadYaml('https://spec.test/a', { maxBytes: 2, fetch: (async () => new Response('large')) as typeof fetch })).rejects.toThrow('maxBytes');
  });
});
