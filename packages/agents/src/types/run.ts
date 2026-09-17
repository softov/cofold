import type { Agent } from './agent.js';
import type { RunCommand } from './command.js';
import type { RunEvent } from './event.js';
import type { ContentPart } from './message.js';
import type { RunOutcome, RunStatus } from './outcome.js';

export interface RunArgs<Resources = Record<string, unknown>> {
  agent: Agent<Resources>;
  session: string;
  /** Stored on the session when it is created; ignored for an existing session. See SessionRecord.workspace. */
  workspace?: string;
  input: string | ContentPart[];
  /** The input message's id; default newId(). A client that supplies it can match run.started to its send. Must be new in the session (cli/03 F2). */
  messageId?: string;
  signal?: AbortSignal;
}

/** `compact()`: a run whose only step writes the summary of the session so far. */
export interface CompactArgs<Resources = Record<string, unknown>> {
  agent: Agent<Resources>;
  session: string;
  /** The ask message's id; default newId(). Must be new in the session (cli/03 F2). */
  messageId?: string;
  signal?: AbortSignal;
}

export interface ResumeArgs<Resources = Record<string, unknown>> {
  agent: Agent<Resources>;
  /** Both come from the `awaiting` outcome (or RunHandle.sessionId / runId). */
  sessionId: string;
  runId: string;
  /** Replay persisted events after this seq before joining the live stream. Default 0. */
  afterSeq?: number;
}

export interface RunHandle {
  readonly runId: string;
  readonly sessionId: string;
  status(): RunStatus;
  /** Ordered from seq 1 (or afterSeq + 1 when reattached); ends after run.finished. */
  readonly events: AsyncIterable<RunEvent>;
  submit(command: RunCommand): Promise<void>;
  cancel(args?: { reason?: string }): void;
  readonly outcome: Promise<RunOutcome>;
}
