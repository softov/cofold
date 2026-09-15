import type { AskAnswers } from './ask.js';

export type RunCommand =
  | {
      type: 'approve';
      requestId: string;
      /** Edited arguments; re-validated against the tool schema before execution (decision 48). */
      input?: unknown;
      /** Remember the decision for this tool name in this session (decision 63). */
      alwaysApprove?: boolean;
    }
  | { type: 'deny'; requestId: string; reason?: string }
  | { type: 'answer'; requestId: string; answers: AskAnswers }
  | { type: 'cancel'; reason?: string };
