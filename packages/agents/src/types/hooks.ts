import type { ToolCallPart } from './message.js';
import type { ModelReply, ModelRequest } from './model.js';
import type { Tool, ToolOutput } from './tool.js';
import type { RunEvent } from './event.js';

export interface RunInfo { runId: string; sessionId: string; agentId: string; step: number }

export interface BeforeModelArgs { request: ModelRequest; run: RunInfo }
export type BeforeModelResult = { request: ModelRequest } | { abort: { reason: string } };

export interface AfterModelArgs { reply: ModelReply; run: RunInfo }
export type AfterModelResult = { reply: ModelReply } | { abort: { reason: string } };

export interface BeforeToolArgs { call: ToolCallPart; tool: Tool; run: RunInfo }
export type BeforeToolResult =
  | { decision: 'allow' }
  | { decision: 'modify'; input: unknown }
  | { decision: 'deny'; reason: string }
  | { decision: 'approval'; prompt?: string };

export interface AfterToolArgs { call: ToolCallPart; tool: Tool; output: ToolOutput; isError: boolean; run: RunInfo }
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
