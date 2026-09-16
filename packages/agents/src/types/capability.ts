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
 * Skills are a core capability over SkillSource (p3); MCP servers come from a separate client package. The core never learns their formats.
 */
export interface Capability {
  /** Stable id; unique within an agent. Becomes Tool.source for its tools and the section label in the prompt. */
  id: string;
  /**
   * Marks the contributed tools deferred (AGENT-02): `true` every one, `{ over: N }` those past the
   * first N in the order `tools()` returns them. A tool's own `deferred` is left as it is when unset here.
   */
  defer?: boolean | { over: number };
  /** `Tool<any, any>` (decision 67): a capability returns tools of mixed input types. */
  tools?(args: CapabilityArgs): Tool<any, any>[] | Promise<Tool<any, any>[]>;
  /** Text appended to the agent instructions under a `## <id>` heading; undefined contributes nothing this run. */
  instructions?(args: CapabilityArgs): string | undefined | Promise<string | undefined>;
}
