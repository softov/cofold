import type { Message } from './message.js';
import type { Usage } from './model.js';

export type RunStatus = 'running' | 'completed' | 'awaiting' | 'stopped' | 'cancelled' | 'failed';

export type StopReason = 'max_steps' | 'max_tool_calls' | 'timeout' | 'policy';

export type RunOutcome =
  | { status: 'completed'; message: Message; usage: Usage; steps: number }
  | { status: 'awaiting'; sessionId: string; runId: string; requestId: string; kind: 'approval' | 'input'; usage: Usage; steps: number }
  | { status: 'stopped'; reason: StopReason; usage: Usage; steps: number }
  | { status: 'cancelled'; reason?: string; usage: Usage; steps: number }
  | { status: 'failed'; error: { code: string; message: string; detail?: unknown }; usage: Usage; steps: number };
