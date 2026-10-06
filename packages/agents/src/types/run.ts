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
  /** The model reference this run uses, stored on the run record as given. */
  model?: string;
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
  /** `running`, `awaiting` while the run waits on a decision, `running` again on the command, then the outcome's status. */
  status(): RunStatus;
  /**
   * Ordered from seq 1 (or afterSeq + 1 when reattached). A pause's `run.finished { awaiting }` is mid-stream; the
   * stream ends after the last `run.finished`, which is the one that is not `awaiting` (decision 122).
   */
  readonly events: AsyncIterable<RunEvent>;
  /** `approve`, `deny` and `answer` across the run's own pause (decision 122); `steer` while it runs; `cancel` any time. */
  submit(command: RunCommand): Promise<void>;
  cancel(args?: { reason?: string }): void;
  /**
   * Leaves a paused run in this process without answering it: the request stays open in the store and a later
   * `resume()` answers it, while this handle closes with the outcome the store holds - the pause's own `awaiting`
   * when nobody answered. What a host that stops caring about a pause calls, so the run is not held here. Does
   * nothing on a handle that is not waiting.
   */
  detach(): void;
  /** Resolves once, when the run really ends; never at a pause (decision 122). */
  readonly outcome: Promise<RunOutcome>;
}
