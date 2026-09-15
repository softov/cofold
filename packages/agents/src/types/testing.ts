import type { ModelAdapter, ModelRequest, Usage } from './model.js';

export type FakeStep =
  | { text: string; usage?: Usage }
  | { toolCalls: { name: string; input: unknown; callId?: string }[]; text?: string; usage?: Usage }
  | { error: { code: 'server' | 'rate_limit' | 'network'; message?: string; retryable?: boolean } }
  | { rawToolCall: { name: string; raw: string; callId?: string } };

export interface FakeModel extends ModelAdapter {
  /** Every request received, in order, with the signal removed. */
  readonly requests: Omit<ModelRequest, 'signal'>[];
  /** Steps left in the script. */
  remaining(): number;
}
