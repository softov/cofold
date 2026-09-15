import type { RunEvent } from './event.js';
import type { ToolCallPart } from './message.js';
import type { ModelReply, ModelRequest } from './model.js';
import type { KvScope } from './store.js';
import type { Tool, ToolOutput } from './tool.js';

export interface RunInfo {
  runId: string;
  sessionId: string;
  agentId: string;
  /** 1-based index of the model step in progress; tool calls report the step that proposed them. */
  step: number;
  /** Same scopes as ToolContext.kv (decision 49). */
  kv: { agent: KvScope; shared: KvScope; workspace?: KvScope };
}

export interface BeforeModelArgs { request: ModelRequest; run: RunInfo }
export type BeforeModelResult = { request: ModelRequest } | { abort: { reason: string } };

export interface AfterModelArgs { reply: ModelReply; run: RunInfo }
export type AfterModelResult = { reply: ModelReply } | { abort: { reason: string } };

/** `tool` is `Tool<any, any>` (decision 67): execute's input is contravariant, so a typed tool would not be assignable. */
export interface BeforeToolArgs { call: ToolCallPart; tool: Tool<any, any>; run: RunInfo }
export type BeforeToolResult =
  | { decision: 'allow' }
  | { decision: 'modify'; input: unknown }
  | { decision: 'deny'; reason: string }
  | { decision: 'approval'; prompt?: string };

export interface AfterToolArgs { call: ToolCallPart; tool: Tool<any, any>; output: ToolOutput; isError: boolean; run: RunInfo }
export type AfterToolResult = { output: ToolOutput; isError?: boolean };

export type HookHandler<Args, Result> = (args: Args) => Result | Promise<Result>;

/**
 * Property syntax (not method syntax) on purpose: method signatures are bivariant in TypeScript,
 * property function types are checked strictly, so a host assigning a wrongly typed handler fails at compile time.
 */
export interface Hooks {
  beforeModel?: HookHandler<BeforeModelArgs, BeforeModelResult>;
  afterModel?: HookHandler<AfterModelArgs, AfterModelResult>;
  beforeTool?: HookHandler<BeforeToolArgs, BeforeToolResult>;
  afterTool?: HookHandler<AfterToolArgs, AfterToolResult>;
  /** Observer. Errors are logged and ignored. */
  onEvent?(event: RunEvent): void;
}
