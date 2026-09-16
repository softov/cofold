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
  /** Refuses an approval, or declines to answer an input request; the tool's result carries the reason. */
  | { type: 'deny'; requestId: string; reason?: string }
  | { type: 'answer'; requestId: string; answers: AskAnswers }
  /** A message for the running turn; appended to the transcript before the next model step (decision 95). */
  | { type: 'steer'; text: string }
  | { type: 'cancel'; reason?: string };
