import type { CommandGroup, JsonSchema } from "@doopx/commands";
export interface ManifestOption {
  name: string;
  short?: string;
  value?: string;
  description: string;
  /**
   * What the value must be, exactly as the command declared it.
   *
   * Carried rather than flattened: this was four fields copied out of a
   * coercer, which meant a client rebuilt an approximation of the rule and
   * anything the four could not express - a length, a pattern - was enforced
   * at one end and unknown at the other.
   */
  schema: JsonSchema;
  repeatable?: boolean;
  required?: boolean;
  env?: string;
  field?: string;
}

export interface HttpBinding {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  contentType?: "application/json" | "application/x-www-form-urlencoded";
  /** `/cases/{id}` - each `{name}` is filled from the canonical input. */
  path: string;
  /**
   * Canonical field names sent as the query string.
   *
   * An override. Left out, `placementOf` decides, which is the answer for
   * every ordinary request and cannot name an option that does not exist.
   */
  query?: readonly string[];
  /** The same override for the body. `"*"` sends everything the path left. */
  body?: readonly string[];
}

export interface ManifestCommand {
  id: string;
  pattern: readonly string[];
  summary: string;
  description?: string;
  group?: string;
  arguments?: Record<string, { schema: JsonSchema; description?: string }>;
  options?: readonly ManifestOption[];
  http: HttpBinding;
}

export interface ProgramManifest {
  facio: number;
  program: { name: string; version: string; description?: string };
  groups?: readonly CommandGroup[];
  commands: readonly ManifestCommand[];
}

/** What a command built from a manifest calls. Supplied by a capability, never imported. */
export interface Transport {
  request(binding: HttpBinding, input: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface CommandsFromOptions {
  /** The capability name a command built from a manifest declares it needs. */
  capability?: string;
  /** Prefixed to every pattern, when a client namespaces a remote surface. */
  prefix?: readonly string[];
  /** Which commands become MCP tools. Off by default, as everywhere else. */
  expose?(command: ManifestCommand): boolean;
}
