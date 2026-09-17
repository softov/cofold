import type { Usage } from '@facio/agents';
import type { ChatPendingInput, ChatToolCall } from '@textui/chat';
import type { Queued } from './chat.js';
import type { Settings } from './settings.js';

export type TurnState = 'running' | 'complete' | 'cancelled' | 'failed';

/** One row group of an agent's reply, in transcript order. */
export type TurnPart =
  /** `streaming` on a text or reasoning part: it is the draft of the step being written (decision CLI-04.2). */
  | { kind: 'text'; id: string; text: string; streaming?: true }
  | { kind: 'reasoning'; id: string; text: string; streaming?: true }
  | { kind: 'tool'; id: string; call: ChatToolCall }
  | { kind: 'error'; id: string; message: string }
  /** What the person said while the turn ran, where it landed in the transcript (decision 95). */
  | { kind: 'steer'; id: string; text: string }
  /** The conversation so far folded into one text (`/compact`, or the auto-compaction); later requests start here. */
  | { kind: 'summary'; id: string; text: string; before?: number; after?: number }
  /** A line from the runtime rather than the model: what a command printed, what a compaction did. */
  | { kind: 'notice'; id: string; text: string };

/**
 * The reply of the step being written, folded from the handle's `model.delta` events in memory
 * (decision CLI-04.2): it exists only while the step runs and is gone at `model.completed`, when
 * the stored message takes its place. The one screen state that is not in the store.
 */
export interface Draft {
  runId: string;
  step: number;
  text: string;
  reasoning: string;
}

/**
 * What a compaction did, read from the run's `context.compacted` event (cli/03 F1, F7): which run wrote the
 * summary, and the tokens the model's view held before and after. Keyed by the summary message's id.
 */
export interface Compaction {
  runId: string;
  before: number;
  after: number;
}

/**
 * One run of a session, as a conversation reads it: what was asked, what came back, how it ended.
 *
 * Projected from the store alone (messages, run records, pending requests), so a session opened
 * after this process died reads the same as one it is running.
 */
export interface Turn {
  /** The run id. */
  id: string;
  input: string;
  parts: TurnPart[];
  state: TurnState;
  model?: string;
  startedAt: string;
  endedAt?: string;
  /** What the run's model steps cost, as the provider reported it. */
  usage: Usage;
  steps: number;
}

/** Everything a screen needs about one session, read at once. */
export interface Snapshot {
  session: SessionRow;
  settings: Settings;
  turns: Turn[];
  /** The block waiting on a person, when the newest run is `awaiting`. */
  pending: ChatPendingInput | null;
  running: boolean;
  /** The messages waiting to be the next turns, in order (decision CLI-04.1). */
  queued: Queued[];
}

export type SessionActivity = 'idle' | 'running' | 'awaiting' | 'failed';

/** One row of the catalogue. */
export interface SessionRow {
  id: string;
  /** The first message, shortened; the id when there is none yet. */
  title: string;
  activity: SessionActivity;
  workspace?: string;
  createdAt: string;
  updatedAt: string;
}
