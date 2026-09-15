import type { KvScope } from './store.js';
import type { Tool } from './tool.js';

export interface CapabilityArgs {
  agentId: string;
  sessionId: string;
  runId: string;
  workspace?: string;
  kv: { agent: KvScope; shared: KvScope; workspace?: KvScope };
  signal: AbortSignal;
}

/**
 * Contributes tools and/or an instructions section to every run (parent decision 31).
 * Resolved by run() at run start, in AgentOptions.capabilities order, before the first model step.
 * MCP servers and skill folders are capabilities provided by later packages; the core never learns their formats.
 */
export interface Capability {
  /** Stable id; unique within an agent. Becomes Tool.source for its tools and the section label in the prompt. */
  id: string;
  tools?(args: CapabilityArgs): Tool[] | Promise<Tool[]>;
  /** Text appended to the agent instructions under a `## <id>` heading; undefined contributes nothing this run. */
  instructions?(args: CapabilityArgs): string | undefined | Promise<string | undefined>;
}
