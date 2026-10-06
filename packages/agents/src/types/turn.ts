import type { RunAbort } from './abort.js';
import type { Agent } from './agent.js';
import type { AskQuestion } from './ask.js';
import type { RunCommand } from './command.js';
import type { Emitter } from './emitter.js';
import type { RunEvent } from './event.js';
import type { RunInfo } from './hooks.js';
import type { ToolCallPart, ToolResultPart } from './message.js';
import type { Usage } from './model.js';
import type { RunOutcome, RunStatus } from './outcome.js';
import type { RunHandle } from './run.js';
import type { Denial, PendingRequest, Store } from './store.js';
import type { Tool } from './tool.js';

export type ToolCallResult =
  | { kind: 'result'; part: ToolResultPart; executed: boolean }
  | { kind: 'approval'; tool: Tool<any, any>; input: unknown; prompt?: string }
  | { kind: 'input'; tool: Tool<any, any>; input: unknown; invocationId: string; questions: AskQuestion[] }
  | { kind: 'aborted' }
  /** A hook ended the run at this call (decision 97); `part` is what the transcript gets for it. */
  | { kind: 'stop'; part: ToolResultPart; executed: boolean; stoppedBy: 'beforeTool' | 'afterTool'; reason: string };

export interface ToolCallDeps {
  agent: Agent<any>;
  tools: ReadonlyMap<string, Tool<any, any>>;
  run: RunInfo;
  abort: RunAbort;
  emit: Emitter['emit'];
  /** Next StepRecord.index; the caller increments after a step is appended. */
  nextStepIndex: () => number;
  /** Records a refused call on the run (cli/03 F3); the loop pushes into `ctx.counters.denials`. */
  denied: (denial: Denial) => void;
  /** Names of the deferred tools whose definitions the model has this session (AGENT-02); shared with the context. */
  loaded: Set<string>;
}

/** One `submit({ type: 'steer' })` waiting for the loop; its promise settles once the text is in the transcript (decision 95). */
export interface Steer { text: string; resolve: () => void; reject: (e: Error) => void }
export type SteerQueue = Steer[];

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
  /** Deferred tools loaded this session, from `kv.agent` `loaded-tools/<sessionId>`; `requestToolsOf` reads it. */
  loaded: Set<string>;
  /** The agent's instructions with the capability sections; the `## tools` index is added per step (`instructionsOf`). */
  instructions: string;
  abort: RunAbort;
  emit: Emitter['emit'];
  handle: InternalRunHandle;
  /**
   * The acceptor while a request is open, cleared once a command is taken (decision 122); `waitForCommand` installs it
   * and both the run() and the resume() handle reach it through the context.
   */
  accept?: ((command: Exclude<RunCommand, { type: 'cancel' | 'steer' }>) => Promise<void>) | undefined;
  /**
   * Drops the open wait without answering it: the acceptor and the abort listener go and the wait resolves
   * `undefined`, leaving the request open in the store. Installed beside `accept` by `waitForCommand` and called
   * when the run leaves its pause unanswered - a failed announcement, or a handle that detaches (review fixes 3, 4).
   */
  dropWait?: (() => void) | undefined;
  /** Steers the handle took since the last model step; drained at the top of the next one, rejected when the run settles. */
  steering: SteerQueue;
  /** `cost` is `undefined` while the adapter has no pricing (decision 108), so an unknown price never reads as free. */
  counters: { usage: Usage; steps: number; cost: number | undefined; denials: Denial[]; stepIndex: number; toolCalls: number };
  claimed: boolean;
  /** A `compact()` run: one summary step, no tools, then done. */
  compact: boolean;
  /** The run's input message; an auto-compaction leaves it out of the summary. */
  inputMessageId?: string;
  /** Writer lease timer (decision 68); stopped at a pause, restarted by the command, cleared when the run settles. */
  heartbeat?: ReturnType<typeof setInterval> | undefined;
}

/** The pending request a command answered, applied to the first call of a resumed batch (decisions 74-77). */
export interface ResolvedRequest {
  pending: PendingRequest;
  command: Exclude<RunCommand, { type: 'cancel' | 'steer' }>;
}

/** Where to enter the loop: a fresh turn, or the rest of a paused batch. */
export type TurnEntry =
  | { kind: 'model' }
  | { kind: 'batch'; calls: ToolCallPart[]; resolved?: ResolvedRequest };

export interface InternalRunHandle extends RunHandle {
  /** Called by the loop for every persisted event. */
  publish(event: RunEvent): void;
  /** Moves `status()` without closing the handle: `awaiting` at a pause, `running` again on the command (decision 122). */
  setStatus(status: RunStatus): void;
  /** Called once by the loop with the final outcome; closes the event stream. */
  finish(outcome: RunOutcome): void;
}
