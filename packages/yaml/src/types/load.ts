import type { YamlParseOptions } from "./parse.js";

export interface YamlLoadOptions extends YamlParseOptions {
  refs?: { local?: boolean; remote?: boolean; circular?: "error" | "preserve"; unresolved?: "error" | "preserve" };
  readFile?(path: string): Promise<string> | string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxDocuments?: number;
}

export interface LoadedYaml { data: unknown; sources: string[]; diagnostics: { reference: string; message: string }[] }
