import type { ModelAdapter, ModelRequest, Usage } from './model.js';

export type FakeStep =
  /**
   * A text answer. `reasoning` becomes a reasoning part before the text. When the fake streams, `chunks` are the
   * text deltas (default: one per word, spaces attached) and `interrupt` ends the stream after them without `done`.
   */
  | { text: string; reasoning?: string; usage?: Usage; chunks?: string[]; interrupt?: true }
  | { toolCalls: { name: string; input: unknown; callId?: string }[]; text?: string; reasoning?: string; usage?: Usage }
  | { error: { code: 'server' | 'rate_limit' | 'network'; message?: string; retryable?: boolean } }
  | { rawToolCall: { name: string; raw: string; callId?: string } };

export interface FakeModel extends ModelAdapter {
  /** Every request received, in order, with the signal removed. */
  readonly requests: Omit<ModelRequest, 'signal'>[];
  /** Steps left in the script. */
  remaining(): number;
}
