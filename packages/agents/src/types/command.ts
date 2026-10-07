import type { AskAnswers } from './ask.js';
import type { ImagePart, TextPart } from './message.js';

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
  /**
   * A message for the running turn; appended to the transcript before the next model step (decision 95).
   * `parts` ride with it: the message is the text part when `text` is not empty, then the parts.
   */
  | { type: 'steer'; text: string; parts?: (TextPart | ImagePart)[] }
  | { type: 'cancel'; reason?: string };
