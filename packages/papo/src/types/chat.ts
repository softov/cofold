import type { AskAnswers, ModelInfo, ModelProvider, RunOutcome, SkillIndexEntry, Store, Tool } from '@facio/agents';
import type { ClaudeSdkSubset } from './claude.js';
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

/** What `createClaudeChat` is built from: the CLI's runtime needs no provider and no store of its own. */
export interface ClaudeChatOptions {
  config: PapoConfig;
  /** Where the CLI works; its sessions are kept per `cwd`. */
  workspace: string;
  /** The file store's root: a session's settings are kept in its kv, as the harness backend keeps them. */
  home: string;
  warn?: (message: string) => void;
  /** The SDK, when a test hands in a fake; otherwise the optional peer, loaded on first use. */
  sdk?: ClaudeSdkSubset;
}

/** One configured provider, as the shell and the model chip list them; the key itself is never carried. */
export interface ProviderRow {
  id: string;
  baseUrl?: string;
  /** Whether a key is configured for it. */
  key: boolean;
  /** What a new conversation starts on: the configured model's provider, else the first listed (cli/01 decision 11). */
  default: boolean;
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
  /** The text went into the turn already running (decision 95) rather than starting one; `runId` is that turn's. */
  steered?: true;
}

/**
 * A message waiting to be the session's next turn (decision CLI-04.1). Held in memory next to the
 * session's handle: it dies with the process, as the reference's does.
 */
export interface Queued {
  id: string;
  text: string;
  /** Applied to the session before the turn starts, as `say`'s `settings` are. */
  settings?: Partial<Settings>;
  /** When it was queued, ISO 8601. */
  at: string;
}

export type ChatListener = (sessionId: string) => void;

/** What the queues need of the service that holds them. */
export interface QueueDeps {
  /** Starts the head as the session's next turn; a rejection leaves it at the head and is warned once. */
  start(sessionId: string, head: Queued): Promise<unknown>;
  /** Nothing of the session runs or waits on a decision here: a message queued now is the next turn at once. */
  idle(sessionId: string): Promise<boolean>;
  warn(message: string): void;
  notify(sessionId: string): void;
}

/** The next turns of every session, in memory (decision CLI-04.1); `createQueues` in `queue.ts` builds it for both backends. */
export interface Queues {
  list(sessionId: string): Queued[];
  /**
   * Appends, or replaces what waits under the same `id`; on a session that is idle and not held by a
   * cancel, the head starts at once (CLI-04.1, as the reference's `startNext`), so what is returned may
   * already be running.
   */
  add(sessionId: string, args: { id?: string; text: string; settings?: Partial<Settings> }): Promise<Queued>;
  /** AgentError('not_found') when nothing waits under that id. */
  remove(sessionId: string, id: string): void;
  /** After a cancel: the head does not start on the coming settle. */
  hold(sessionId: string): void;
  /** A person said something: the session takes its queue again. */
  release(sessionId: string): void;
  /** The run settled: the head starts when the outcome (`completed | stopped | failed`) and the person allow it. */
  settled(sessionId: string, status: RunOutcome['status']): Promise<void>;
  /** Resolves once a head that is starting has started (or failed to); at once when none is. */
  starting(sessionId: string): Promise<void>;
  /** The session is gone. */
  clear(sessionId: string): void;
}

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
  /**
   * The models on offer. Without `provider`: every configured provider in order, a provider that cannot
   * be reached warned once and skipped, so one that is down never hides the others. With `provider`: that
   * one only; its listing error is the caller's to see, an unknown id is `invalid_options`.
   */
  models(args?: { provider?: string }): Promise<ModelRow[]>;
  /** The providers a model may be chosen from, in the configuration's order; asks nothing of the network. */
  providers(): Promise<ProviderRow[]>;
  /** The skills the agent may read: global ones under `<home>/skills` and the workspace's own; what a slash offers. */
  skills(): Promise<SkillIndexEntry[]>;
  sessions(): Promise<SessionRow[]>;
  /**
   * The session as the screen draws it: the model's view of the transcript (cli/03 F1), so after a
   * compaction the summary turn comes first, then what it did not cover; `all` shows every message
   * instead (`session show --all`). AgentError('not_found') when the session is not there.
   */
  snapshot(sessionId: string, options?: { all?: boolean }): Promise<Snapshot>;
  /**
   * One turn. A missing `sessionId` starts a session; `settings` given here are stored on the session
   * first. While a run of the session is still going here the text steers it (decision 95): it lands
   * in the transcript before the next model step, and `Started.steered` says so. AgentError('writer_busy')
   * while the session waits on a decision; answer it first.
   */
  say(args: { sessionId?: string; text: string; settings?: Partial<Settings> }): Promise<Started>;
  /**
   * A message that becomes the session's next turn once the running one settles `completed`,
   * `stopped` or `failed`, or at once when nothing runs; nothing starts after a `cancel` until the
   * person speaks again (decision CLI-04.1). The same `id` again replaces what waits. In memory: gone
   * with the process.
   */
  queue(args: { sessionId: string; text: string; settings?: Partial<Settings>; id?: string }): Promise<Queued>;
  /** AgentError('not_found') when nothing waits under that id. */
  unqueue(sessionId: string, id: string): Promise<void>;
  /** What waits to be the session's next turns, in order. */
  queued(sessionId: string): Promise<Queued[]>;
  /** The outcome of the run attached to the session, or undefined when none is; a queued head that is starting counts as attached. */
  wait(sessionId: string): Promise<RunOutcome | undefined>;
  approve(sessionId: string, args?: { always?: boolean }): Promise<void>;
  /** Refuses a waiting approval, or declines a waiting question; the tool's result carries the reason. */
  deny(sessionId: string, args?: { reason?: string }): Promise<void>;
  answer(sessionId: string, answers: AskAnswers): Promise<void>;
  /** Stops the turn: a running one is aborted; one waiting on a decision has it denied and ends cancelled (decision 120). */
  cancel(sessionId: string): Promise<void>;
  /** Fold the conversation so far into a summary, as a run of its own; `wait` sees it end. Refused while a turn runs or waits. */
  compact(sessionId: string): Promise<Started>;
  remove(sessionId: string): Promise<void>;
  /** Called with the session whose state changed; returns the unsubscribe. */
  subscribe(listener: ChatListener): () => void;
  /** Cancels every attached run. */
  close(): Promise<void>;
}
