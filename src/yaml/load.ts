import { readFile as readLocal } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseYaml, type YamlParseOptions } from "./yaml.js";

export interface YamlLoadOptions extends YamlParseOptions {
  refs?: { local?: boolean; remote?: boolean; circular?: "error" | "preserve"; unresolved?: "error" | "preserve" };
  readFile?(path: string): Promise<string> | string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxDocuments?: number;
}
export interface LoadedYaml { data: unknown; sources: string[]; diagnostics: { reference: string; message: string }[] }

/** Parse YAML or JSON and optionally resolve references relative to each containing document. */
export async function loadYaml(source: string, options: YamlLoadOptions = {}): Promise<LoadedYaml> {
  const root = /^(?:https?:|file:)/u.test(source) ? new URL(source) : pathToFileURL(resolve(source));
  const cache = new Map<string, Promise<unknown>>();
  const diagnostics: LoadedYaml["diagnostics"] = [];
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const read = (url: URL): Promise<unknown> => {
    const address = new URL(url); address.hash = "";
    const key = address.href;
    const prior = cache.get(key); if (prior) return prior;
    if (cache.size >= (options.maxDocuments ?? 1024)) throw new Error("Reference loading exceeds maxDocuments");
    const pending = (async () => {
      let text: string;
      if (address.protocol === "file:") text = await (options.readFile ?? ((path) => readLocal(path, "utf8")))(fileURLToPath(address));
      else if (address.protocol === "https:" || address.protocol === "http:") {
        const response = await (options.fetch ?? globalThis.fetch)(address, { signal: AbortSignal.timeout(options.timeoutMs ?? 30_000), redirect: "error" });
        if (!response.ok) throw new Error(`${address.href} returned HTTP ${response.status}`);
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw new Error(`${address.href} exceeds maxBytes`); } chunks.push(part.value); } }
        text = Buffer.concat(chunks).toString("utf8");
      } else throw new Error(`Unsupported reference protocol ${address.protocol}`);
      if (Buffer.byteLength(text) > maxBytes) throw new Error(`${address.href} exceeds maxBytes`);
      return address.pathname.endsWith(".json") ? JSON.parse(text) as unknown : parseYaml(text, { ...options, source: address.href });
    })();
    cache.set(key, pending); return pending;
  };
  const pointer = (data: unknown, hash: string): unknown => {
    if (!hash || hash === "#") return data;
    const path = decodeURIComponent(hash.slice(1));
    if (!path.startsWith("/")) throw new Error(`Reference fragment ${hash} must be a JSON Pointer`);
    let value = data;
    for (const part of path.slice(1).split("/")) {
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Reference ${hash} does not exist`);
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  };
  const visit = async (value: unknown, base: URL, chain: string[], depth: number): Promise<unknown> => {
    if (depth > (options.maxDepth ?? 128)) throw new Error(`Reference nesting exceeds maxDepth: ${chain.join(" -> ")}`);
    if (Array.isArray(value)) { const out: unknown[] = []; for (const entry of value) out.push(await visit(entry, base, chain, depth + 1)); return out; }
    if (value === null || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (typeof object["$ref"] === "string" && options.refs !== undefined) {
      const target = new URL(object["$ref"], base);
      const external = target.href.split("#")[0] !== base.href.split("#")[0];
      if (external && target.protocol === "file:" && (options.refs.local !== true || base.protocol !== "file:")) throw new Error(`Local reference is not allowed: ${target.href}`);
      if (external && /^https?:$/u.test(target.protocol) && options.refs.remote !== true) throw new Error(`Remote reference is not allowed: ${target.href}`);
      if (chain.includes(target.href)) {
        if (options.refs.circular === "preserve") return { $ref: target.href };
        throw new Error(`Circular reference: ${[...chain, target.href].join(" -> ")}`);
      }
      let result: unknown;
      try { result = await visit(pointer(await read(target), target.hash), target, [...chain, target.href], depth + 1); }
      catch (error) {
        if (options.refs.unresolved !== "preserve") throw error;
        diagnostics.push({ reference: target.href, message: error instanceof Error ? error.message : String(error) });
        return { $ref: target.href };
      }
      const siblings = Object.entries(object).filter(([key]) => key !== "$ref");
      if (siblings.some(([key]) => !["summary", "description"].includes(key))) throw new Error(`Unsupported $ref siblings at ${base.href}; constraints must be in the referenced schema`);
      return siblings.length && result !== null && typeof result === "object" ? { ...result, ...Object.fromEntries(siblings) } : result;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(object)) Object.defineProperty(out, key, { value: await visit(entry, base, chain, depth + 1), enumerable: true });
    return out;
  };
  const data = await visit(pointer(await read(root), root.hash), root, [], 0);
  return { data, sources: [...cache.keys()], diagnostics };
}
