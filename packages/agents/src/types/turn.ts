import type { RunAbort } from './abort.js';
import type { Agent } from './agent.js';
import type { AskQuestion } from './ask.js';
import type { RunCommand } from './command.js';
import type { Emitter } from './emitter.js';
import type { RunEvent } from './event.js';
import type { RunInfo } from './hooks.js';
import type { ToolCallPart, ToolResultPart } from './message.js';
import type { Usage } from './model.js';
import type { RunOutcome } from './outcome.js';
import type { RunHandle } from './run.js';
import type { PendingRequest, Store } from './store.js';
import type { ModelToolDefinition, Tool } from './tool.js';

export type ToolCallResult =
  | { kind: 'result'; part: ToolResultPart; executed: boolean }
  | { kind: 'approval'; tool: Tool<any, any>; input: unknown; prompt?: string }
  | { kind: 'input'; tool: Tool<any, any>; input: unknown; invocationId: string; questions: AskQuestion[] }
  | { kind: 'aborted' };

export interface ToolCallDeps {
  agent: Agent<any>;
  tools: ReadonlyMap<string, Tool<any, any>>;
  run: RunInfo;
  abort: RunAbort;
  emit: Emitter['emit'];
  /** Next StepRecord.index; the caller increments after a step is appended. */
  nextStepIndex: () => number;
}

/** Everything the loop needs; built by run() for a fresh turn and by resume() from a stored run. */
export interface TurnContext {
  agent: Agent<any>;
  store: Store;
  sessionId: string;
  runId: string;
  agentId: string;
  workspace?: string;
  run: RunInfo;
  tools: Map<string, Tool<any, any>>;
  toolDefinitions: ModelToolDefinition[];
  instructions: string;
  abort: RunAbort;
  emit: Emitter['emit'];
  handle: InternalRunHandle;
  counters: { usage: Usage; steps: number; stepIndex: number; toolCalls: number };
  claimed: boolean;
  /** Writer lease timer (decision 68); cleared when the run settles, before the outcome is published. */
  heartbeat?: ReturnType<typeof setInterval>;
}

/** The pending request a command answered, applied to the first call of a resumed batch (decisions 74-77). */
export interface ResolvedRequest {
  pending: PendingRequest;
  command: Exclude<RunCommand, { type: 'cancel' }>;
}

/** Where to enter the loop: a fresh turn, or the rest of a paused batch. */
export type TurnEntry =
  | { kind: 'model' }
  | { kind: 'batch'; calls: ToolCallPart[]; resolved?: ResolvedRequest };

export interface InternalRunHandle extends RunHandle {
  /** Called by the loop for every persisted event. */
  publish(event: RunEvent): void;
  /** Called once by the loop with the final outcome; closes the event stream. */
  finish(outcome: RunOutcome): void;
}
