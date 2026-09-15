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
  | { type: 'run.paused'; requestId: string; kind: 'approval' | 'input' }
  | { type: 'run.resumed'; requestId: string }
  | { type: 'run.finished'; outcome: RunOutcome };

export type RunEvent = EventBase & RunEventBody;
export type RunEventType = RunEventBody['type'];
