import type { Command, RequestContext } from "@doopx/commands";
import type { JsonSchema } from "@doopx/sdk";
import type { McpBinding } from "./binding.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object"; properties: Record<string, JsonSchema>; required?: string[] };
  annotations?: McpBinding["annotations"];
  outputSchema?: JsonSchema & { type: "object" };
  /** The command behind it, for a caller that wants to annotate or filter. */
  command: Command;
  invoke(input: Record<string, unknown>): Promise<unknown>;
}

export interface ToolOptions {
  /** Exposed only when the command opted in; this widens nothing by accident. */
  filter?(command: Command): boolean;
  signal?: AbortSignal;
  request?: Readonly<RequestContext>;
  onCleanupError?: (error: unknown) => void;
}
