import type { RunEvent } from './event.js';
import type { Message } from './message.js';
import type { ModelRequest, ModelReply } from './model.js';
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

export interface RunRecord {
  runId: string;
  sessionId: string;
  agentId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  /** Set when status is 'awaiting'. */
  pendingRequestId?: string;
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
      startedAt: string;
      endedAt?: string;
    };

export interface PendingRequest {
  requestId: string;
  sessionId: string;
  runId: string;
  kind: 'approval' | 'input';
  /** For approvals: the tool call awaiting a decision. */
  callId?: string;
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
    /** Fails with StoreError('writer_mismatch') unless runId holds the claim. */
    appendMessages(args: { sessionId: string; runId: string; messages: Message[] }): Promise<void>;
    listMessages(args: { sessionId: string; limit?: number }): Promise<Message[]>;
    /** Returns false when another run holds the claim. */
    claimWriter(args: { sessionId: string; runId: string }): Promise<boolean>;
    releaseWriter(args: { sessionId: string; runId: string }): Promise<void>;
  };
  runs: {
    /** Fails with StoreError('already_exists') when the runId is taken; never overwrites. */
    create(record: RunRecord): Promise<void>;
    get(args: RunRef): Promise<RunRecord | undefined>;
    update(args: RunRef & { status: RunStatus; pendingRequestId?: string }): Promise<void>;
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
