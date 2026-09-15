import type { AskAnswers, ModelInfo, ModelProvider, RunOutcome, Store, Tool } from '@facio/agents';
import type { PapoConfig } from './config.js';
import type { SessionRow, Snapshot } from './turn.js';

export interface ChatOptions {
  store: Store;
  config: PapoConfig;
  providers: ModelProvider[];
  /** Where the agent works; the sessions' partition key. */
  workspace: string;
  /** The store's root; global skills live under `<home>/skills`. */
  home: string;
  /** Beyond `ask_user`. */
  tools?: Tool<any, any>[];
  /** Where one-time warnings go; stderr by default. */
  warn?(message: string): void;
}

/** A model as the catalogue names it: `<providerId>/<modelId>`. */
export interface ModelRow extends ModelInfo {
  provider: string;
  /** `<providerId>/<modelId>`. */
  ref: string;
}

/** What `say` returns: where the turn is, so a shell can wait on it or a screen can watch it. */
export interface Started {
  sessionId: string;
  runId: string;
}

export type ChatListener = (sessionId: string) => void;

/**
 * The conversation service: the harness in this process, as both fronts use it.
 *
 * Everything reads from the store and is projected on demand; a run attached here only wakes the
 * listeners. A session whose newest run is waiting when this process starts is resumed on the first
 * command that needs it, which is also the crash recovery.
 */
export interface Chat {
  /** The model new turns use, as `<providerId>/<modelId>`. */
  model(): string;
  models(): Promise<ModelRow[]>;
  sessions(): Promise<SessionRow[]>;
  /** AgentError('not_found') when the session is not there. */
  snapshot(sessionId: string): Promise<Snapshot>;
  /**
   * One turn. A missing `sessionId` starts a session. AgentError('writer_busy') while a run of the
   * session is still going here; steering is the harness's p5.
   */
  say(args: { sessionId?: string; text: string; model?: string }): Promise<Started>;
  /** The outcome of the run attached to the session, or undefined when none is. */
  wait(sessionId: string): Promise<RunOutcome | undefined>;
  approve(sessionId: string, args?: { always?: boolean }): Promise<void>;
  deny(sessionId: string, args?: { reason?: string }): Promise<void>;
  answer(sessionId: string, answers: AskAnswers): Promise<void>;
  /** Aborts a running turn, or denies a waiting approval; a waiting question can only be answered. */
  cancel(sessionId: string): Promise<void>;
  remove(sessionId: string): Promise<void>;
  /** Called with the session whose state changed; returns the unsubscribe. */
  subscribe(listener: ChatListener): () => void;
  /** Cancels every attached run. */
  close(): Promise<void>;
}
