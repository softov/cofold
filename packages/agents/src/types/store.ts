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
  /** Message ids of this turn's input and last appended message; p4 fork/rewind slots. */
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
    /** Fails with StoreError('writer_mismatch') unless runId holds the claim. */
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
