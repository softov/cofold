import type { AskAnswers, ModelInfo, ModelProvider, RunOutcome, SkillIndexEntry, Store, Tool } from '@facio/agents';
import type { PapoConfig } from './config.js';
import type { Settings } from './settings.js';
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
  /**
   * What a session runs with: its own choices over the configuration's defaults. Without a session
   * id, the defaults a new conversation starts from. The model is resolved (the first listed one when
   * none is configured), which may ask the provider once.
   */
  settings(sessionId?: string): Promise<Settings>;
  /** Change a session's settings; validated (a model must be configured, the words must be known). */
  configure(sessionId: string, patch: Partial<Settings>): Promise<Settings>;
  models(): Promise<ModelRow[]>;
  /** The skills the agent may read: global ones under `<home>/skills` and the workspace's own; what a slash offers. */
  skills(): Promise<SkillIndexEntry[]>;
  sessions(): Promise<SessionRow[]>;
  /** AgentError('not_found') when the session is not there. */
  snapshot(sessionId: string): Promise<Snapshot>;
  /**
   * One turn. A missing `sessionId` starts a session; `settings` given here are stored on the session
   * first. AgentError('writer_busy') while a run of the session is still going here; steering is the
   * harness's p5.
   */
  say(args: { sessionId?: string; text: string; settings?: Partial<Settings> }): Promise<Started>;
  /** The outcome of the run attached to the session, or undefined when none is. */
  wait(sessionId: string): Promise<RunOutcome | undefined>;
  approve(sessionId: string, args?: { always?: boolean }): Promise<void>;
  /** Refuses a waiting approval, or declines a waiting question; the tool's result carries the reason. */
  deny(sessionId: string, args?: { reason?: string }): Promise<void>;
  answer(sessionId: string, answers: AskAnswers): Promise<void>;
  /** Aborts a running turn, or denies whatever the session is waiting on. */
  cancel(sessionId: string): Promise<void>;
  /** Fold the conversation so far into a summary, as a run of its own; `wait` sees it end. Refused while a turn runs or waits. */
  compact(sessionId: string): Promise<Started>;
  remove(sessionId: string): Promise<void>;
  /** Called with the session whose state changed; returns the unsubscribe. */
  subscribe(listener: ChatListener): () => void;
  /** Cancels every attached run. */
  close(): Promise<void>;
}
