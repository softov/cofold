import type { Usage } from '@facio/agents';
import type { ChatPendingInput, ChatToolCall } from '@textui/chat';
import type { Settings } from './settings.js';

export type TurnState = 'running' | 'complete' | 'cancelled' | 'failed';

/** One row group of an agent's reply, in transcript order. */
export type TurnPart =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; call: ChatToolCall }
  | { kind: 'error'; id: string; message: string }
  /** The conversation so far folded into one text (`/compact`, or the auto-compaction); later requests start here. */
  | { kind: 'summary'; id: string; text: string };

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
