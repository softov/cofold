import {
  canonicalFromObject,
  compact,
  fieldsOf,
  surfaceEnabled,
  type Command,
  type JsonSchema,
  type Runner,
} from "../index.js";

/**
 * facio/mcp - the same registry, read by an agent.
 *
 * This package is small on purpose, and its size is the argument for the whole
 * library: a tool is a name, a description, and an input schema, and a command
 * already has all three. Hand-writing MCP tools beside a CLI means writing
 * every endpoint twice and watching the two descriptions drift apart within a
 * month.
 *
 * Nothing here imports an MCP SDK. `tools()` returns plain descriptors with
 * JSON Schema, which is what the protocol speaks; wiring them to a particular
 * SDK is six lines in the program that ships the server, and stays that
 * program's choice.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object"; properties: Record<string, JsonSchema>; required?: string[] };
  /** The command behind it, for a caller that wants to annotate or filter. */
  command: Command;
  invoke(input: Record<string, unknown>): Promise<unknown>;
}

/** MCP tool names are not dotted; command ids are. */
export function toolNameOf(command: Command): string {
  return command.id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 64);
}

export function inputSchemaFor(command: Command): ToolDefinition["inputSchema"] {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of fieldsOf(command)) {
    const base: JsonSchema = field.repeated
      ? { type: "array", items: field.coerce.schema }
      : { ...field.coerce.schema };
    if (field.description !== "") base.description = field.description;
    if (field.option?.default !== undefined) base.default = field.option.default;
    properties[field.name] = base;
    if (field.required) required.push(field.name);
  }
  return { type: "object", properties, ...compact({ required: required.length === 0 ? undefined : required }) };
}

/**
 * Written for an agent rather than for a person.
 *
 * The summary is the first line either way; what an agent additionally needs is
 * the long description and an example invocation, because a tool call it has to
 * guess the shape of is a tool call it gets wrong once and then avoids.
 */
export function descriptionFor(command: Command): string {
  const parts = [command.summary];
  if (command.description !== undefined) parts.push(command.description.trim());
  if (command.examples !== undefined && command.examples.length > 0) {
    parts.push(`Examples:\n${command.examples.map((example) => `  ${example.command}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

export interface ToolOptions {
  /** Exposed only when the command opted in; this widens nothing by accident. */
  filter?(command: Command): boolean;
  signal?: AbortSignal;
}

/**
 * Every command that opted into being a tool.
 *
 * `surfaces.mcp` is off unless a command says otherwise, so registering a
 * package of commands cannot quietly hand an agent a set of arbitrary mutation
 * tools. That default has to live at the declaration, not at the call site
 * here, or somebody eventually passes the wrong filter.
 */
export function tools(registry: Runner, options: ToolOptions = {}): ToolDefinition[] {
  return registry.commands
    .filter((command) => surfaceEnabled(command, "mcp"))
    .filter((command) => options.filter?.(command) ?? true)
    .map((command) => ({
      name: toolNameOf(command),
      description: descriptionFor(command),
      inputSchema: inputSchemaFor(command),
      command,
      invoke: async (raw: Record<string, unknown>): Promise<unknown> => {
        const input = await canonicalFromObject(command, raw);
        const result = await registry.execute(command, {
          surface: "mcp",
          input,
          ...compact({ signal: options.signal }),
        });
        return result?.data ?? null;
      },
    }));
}

/** What a `tools/list` response holds, ready to serialise. */
export function listTools(registry: Runner, options: ToolOptions = {}): {
  tools: { name: string; description: string; inputSchema: unknown }[];
} {
  return {
    tools: tools(registry, options).map(({ name, description, inputSchema }) =>
      ({ name, description, inputSchema })),
  };
}

export class UnknownToolError extends Error {
  public constructor(name: string) {
    super(`No tool called ${name}`);
    this.name = "UnknownToolError";
  }
}

/**
 * A `tools/call`, as the content block the protocol wants.
 *
 * A refusal the agent could act on - bad arguments, a missing id - comes back
 * as `isError` with the message, because that is a thing the agent can fix. A
 * transport failure is left to throw: it is not the agent's to correct, and
 * dressing it up as a tool result invites a retry loop.
 */
export async function callTool(
  registry: Runner,
  name: string,
  input: Record<string, unknown>,
  options: ToolOptions & { recoverable?: (error: unknown) => boolean } = {},
): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> {
  const tool = tools(registry, options).find((candidate) => candidate.name === name);
  if (tool === undefined) throw new UnknownToolError(name);
  try {
    const value = await tool.invoke(input);
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  } catch (error: unknown) {
    const recoverable = options.recoverable ?? defaultRecoverable;
    if (!recoverable(error)) throw error;
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

function defaultRecoverable(error: unknown): boolean {
  const kind = (error as { kind?: string } | null)?.kind;
  return kind === "argument" || kind === "conflict" || kind === "authorization";
}
