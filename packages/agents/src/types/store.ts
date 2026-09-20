import type { AskQuestion } from './ask.js';
import type { RunEvent } from './event.js';
import type { Message } from './message.js';
import type { ModelReply, ModelRequest, Usage } from './model.js';
import type { RunStatus } from './outcome.js';

export interface SessionRecord {
  sessionId: string;
  agentId: string;
  /**
   * Host-supplied partition key (parent decision 29). The CLI passes the cwd; the AHP transport passes
   * SessionOptions.cwd. Absent for hosts without a working directory (chat bots). The file store
   * nests the session under workspaces/<slug>/ when set.
   */
  workspace?: string;
  createdAt: string;
  updatedAt: string;
  /** The run currently allowed to append; undefined when idle. */
  activeWriterRunId?: string;
}

/** Locates a run. Runs live under their session (parent decision 30), so every run-level call carries both ids. */
export interface RunRef {
  sessionId: string;
  runId: string;
}

/** One refused tool call (cli/03 F3). `by` says who refused: the policy, a hook, the person, the validator or a limit. */
export interface Denial {
  callId: string;
  name: string;
  input: unknown;
  reason: string;
  by: 'policy' | 'hook' | 'user' | 'invalid' | 'limit';
}

export interface RunRecord {
  runId: string;
  sessionId: string;
  agentId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  /** Set when status is 'awaiting'. */
  pendingRequestId?: string;
  /** Accumulated by the loop; resume continues from here (decision 73). */
  usage: Usage;
  /** USD so far, when the adapter has pricing (decision 109); absent means unknown, never zero. */
  cost?: number;
  steps: number;
  /** Every refused tool call of the run, in order (cli/03 F3): the authoritative record, `[]` from `runs.create`. */
  denials: Denial[];
  /**
   * The span of the run, and the slots a cut keeps it by (p4 fork/rewind): the id of its input
   * message and the id of the last message it appended. `runs.create` sets `inputMessageId`,
   * and `appendMessages` advances `lastMessageId` with every message written under the run, so
   * the two are exact for any run that appended at least its input.
   */
  inputMessageId?: string;
  lastMessageId?: string;
}

export type StepStatus = 'started' | 'completed' | 'failed' | 'uncertain';

export type StepRecord =
  | {
      kind: 'model';
      sessionId: string;
      runId: string;
      index: number;
      invocationId: string;
      status: StepStatus;
      request?: Omit<ModelRequest, 'signal'>;
      reply?: ModelReply;
      /** Hook abort reason or adapter error summary; never model content. */
      detail?: unknown;
      startedAt: string;
      endedAt?: string;
    }
  | {
      kind: 'tool';
      sessionId: string;
      runId: string;
      index: number;
      invocationId: string;
      status: StepStatus;
      callId: string;
      name: string;
      /** Arguments as validated (and possibly hook-modified) before execution. */
      input: unknown;
      /** Executor output before any afterTool transform. */
      original?: { content: string; isError: boolean; detail?: unknown };
      /** What the model saw, when a hook changed it. */
      transformed?: { content: string; isError: boolean };
      /** Why a hook stopped the run at this call (decision 97); never tool output. */
      detail?: unknown;
      startedAt: string;
      endedAt?: string;
    };

/** `PendingRequest.payload` of an 'approval' request. */
export interface ApprovalPayload { name: string; input: unknown; prompt?: string }

/** `PendingRequest.payload` of an 'input' request; invocationId lets resume complete the same tool step. */
export interface InputPayload { name: string; input: unknown; questions: AskQuestion[]; invocationId: string }

export interface PendingRequest {
  requestId: string;
  sessionId: string;
  runId: string;
  kind: 'approval' | 'input';
  /** For approvals: the tool call awaiting a decision. */
  callId?: string;
  /** ApprovalPayload or InputPayload by `kind`. */
  payload: unknown;
  createdAt: string;
  resolvedAt?: string;
  resolution?: unknown;
}

/**
 * What `sessions.truncate` left behind (p4 fork/rewind): the transcript is a prefix of what it was,
 * and the turns that went with the tail are gone with their runs, events, steps and requests.
 */
export interface TruncationResult {
  /** How many messages remain: `throughMessageId` and everything before it. */
  remainingMessages: number;
  /** How many messages the cut dropped. */
  removedMessages: number;
  /** How many runs, with their events, steps and requests, the cut dropped. */
  removedRuns: number;
}

/**
 * The cut itself, before a store writes it: the messages that remain and the runs kept with them.
 * `selectCut` (in the store runtime) is the one place both stores decide this.
 */
export interface SessionCut {
  /** The messages that remain, in order; `throughMessageId` is the last. */
  messages: Message[];
  /** The terminal runs whose whole span remains, in the order they were given. */
  runs: RunRecord[];
  /** The ids of the runs the cut drops, with their events, steps and requests. */
  removedRunIds: string[];
}

export interface KvScope {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export type KvScopeKey =
  | { kind: 'agent'; agentId: string }
  | { kind: 'shared'; namespace: string }
  | { kind: 'workspace'; workspace: string };

export interface Store {
  sessions: {
    get(args: { sessionId: string }): Promise<SessionRecord | undefined>;
    /** Fails with StoreError('already_exists') when the sessionId is taken; never overwrites. */
    create(args: { sessionId: string; agentId: string; workspace?: string }): Promise<SessionRecord>;
    /** Newest `updatedAt` first. `workspace` and `agentId` filter when given. */
    list(args: { workspace?: string; agentId?: string; limit?: number }): Promise<SessionRecord[]>;
    /**
     * Removes the session with its messages, runs, events, steps and requests. StoreError('not_found')
     * when absent; StoreError('writer_busy') while the claim holder is a run whose status is 'running'.
     * A paused run keeps its claim (it is still the writer) but writes nothing, so it does not block.
     */
    delete(args: { sessionId: string }): Promise<void>;
    /**
     * Cuts the conversation after `throughMessageId` (the message itself is kept; p4 fork/rewind). The
     * messages after it go, and with them the runs, events, steps and requests of the turns that went with
     * them: a run is kept only when it is terminal and both its `inputMessageId` and its `lastMessageId` are
     * among the messages that remain, so a kept turn keeps its usage, step log and tool timings. A terminal
     * run missing either slot is dropped: its span cannot be proven to survive the cut. A non-terminal run at
     * the tail (`running`, `awaiting`) is dropped too and its writer claim is cleared, so the session is free
     * to continue; the caller cancels before a rewind, so the common path is that there is none.
     * StoreError('not_found') for an absent session or a message the session does not hold;
     * StoreError('writer_busy') while the claim holder is a run whose status is 'running' (a paused holder
     * keeps its claim but writes nothing, so it does not block, as `delete` documents).
     */
    truncate(args: { sessionId: string; throughMessageId: string }): Promise<TruncationResult>;
    /**
     * Copies into a new session `sessionId` the source's messages through `throughMessageId`, and the runs
     * kept by the same rule as `truncate` with their events and steps (p4 fork/rewind). The target takes the
     * source's `agentId` and workspace; the source is not modified and its requests are never copied. A
     * `running` or `awaiting` run is never copied. StoreError('already_exists') when the target is taken;
     * StoreError('not_found') for an absent source or a message it does not hold; StoreError('writer_busy')
     * under the same rule as `truncate`.
     */
    fork(args: { fromSessionId: string; throughMessageId: string; sessionId: string }): Promise<SessionRecord>;
    /**
     * Writes the messages and advances the run's `lastMessageId` to the last of them, which is
     * what makes a run's span readable by a cut (p4 fork/rewind). Fails with
     * StoreError('writer_mismatch') unless runId holds the claim; a session whose run record is
     * gone still takes the messages, it just has no span to advance.
     */
    appendMessages(args: { sessionId: string; runId: string; messages: Message[] }): Promise<void>;
    listMessages(args: { sessionId: string; limit?: number }): Promise<Message[]>;
    /**
     * Returns false when another run holds the claim. A durable store may take over a claim whose run is
     * still 'running' but whose heartbeat is older than its stale threshold (decision 68).
     */
    claimWriter(args: { sessionId: string; runId: string }): Promise<boolean>;
    releaseWriter(args: { sessionId: string; runId: string }): Promise<void>;
    /** Refreshes the writer lease (decision 68); StoreError('writer_mismatch') unless runId holds the claim. */
    heartbeat(args: { sessionId: string; runId: string }): Promise<void>;
  };
  runs: {
    /** Fails with StoreError('already_exists') when the runId is taken; never overwrites. */
    create(record: RunRecord): Promise<void>;
    get(args: RunRef): Promise<RunRecord | undefined>;
    /** Newest `createdAt` first (decision 71). */
    list(args: { sessionId: string; status?: RunStatus }): Promise<RunRecord[]>;
    /** Fields present are written; `pendingRequestId: undefined` passed explicitly clears it, absent leaves it. */
    update(args: RunRef & { status: RunStatus; pendingRequestId?: string | undefined; usage?: Usage; steps?: number; cost?: number; denials?: Denial[]; lastMessageId?: string }): Promise<void>;
    /** Fails with StoreError('seq_gap') unless event.seq === last + 1 (first is 1). Located by event.sessionId + event.runId. */
    appendEvent(event: RunEvent): Promise<void>;
    listEvents(args: RunRef & { afterSeq?: number }): Promise<RunEvent[]>;
    /** Located by step.sessionId + step.runId. */
    appendStep(step: StepRecord): Promise<void>;
    updateStep(args: RunRef & { invocationId: string; patch: Partial<StepRecord> }): Promise<void>;
    listSteps(args: RunRef): Promise<StepRecord[]>;
  };
  requests: {
    /** Located by request.sessionId + request.runId. */
    create(request: PendingRequest): Promise<void>;
    get(args: RunRef & { requestId: string }): Promise<PendingRequest | undefined>;
    resolve(args: RunRef & { requestId: string; resolution: unknown }): Promise<void>;
  };
  kv(scope: KvScopeKey): KvScope;
}
