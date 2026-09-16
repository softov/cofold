import type { AskAnswers, AskQuestion } from './ask.js';
import type { Message } from './message.js';
import type { FinishReason, Usage } from './model.js';
import type { RunOutcome } from './outcome.js';

export interface EventBase {
  seq: number;
  runId: string;
  sessionId: string;
  agentId: string;
  at: string;
}

export type RunEventBody =
  | { type: 'run.started'; input: Message }
  /** A steer appended to the transcript, positioned before the next model step (decisions 95-96). */
  | { type: 'run.steered'; message: Message }
  | { type: 'model.started'; step: number }
  | { type: 'model.delta'; step: number; text: string }
  | { type: 'model.completed'; step: number; message: Message; usage: Usage; finish: FinishReason }
  | { type: 'tool.proposed'; callId: string; name: string; input: unknown }
  | { type: 'tool.denied'; callId: string; name: string; reason: string }
  | { type: 'tool.started'; callId: string; name: string; invocationId: string }
  | { type: 'tool.completed'; callId: string; name: string; invocationId: string; content: string; isError: boolean; durationMs: number }
  | { type: 'approval.requested'; requestId: string; callId: string; name: string; input: unknown; prompt?: string }
  | { type: 'approval.resolved'; requestId: string; decision: 'approve' | 'deny'; reason?: string }
  | { type: 'input.requested'; requestId: string; callId: string; questions: AskQuestion[] }
  | { type: 'input.resolved'; requestId: string; answers: AskAnswers }
  /** The person would not answer: the asking tool's result says so and the model goes on. */
  | { type: 'input.declined'; requestId: string; reason?: string }
  | { type: 'run.paused'; requestId: string; kind: 'approval' | 'input' }
  | { type: 'run.resumed'; requestId: string }
  /** The history was folded into one summary message, by `compact()` or the auto-compact threshold. */
  | { type: 'context.compacted'; messageId: string; summarized: number; estimatedTokens: number }
  | { type: 'run.finished'; outcome: RunOutcome };

export type RunEvent = EventBase & RunEventBody;
export type RunEventType = RunEventBody['type'];
