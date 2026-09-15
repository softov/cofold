export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  /** Key of the answer in AskAnswers; unique within one request; /^[a-zA-Z0-9_-]{1,64}$/. */
  id: string;
  question: string;
  /** Short chip shown by UIs (<= 12 chars). */
  header?: string;
  /** When absent the answer is free text. */
  options?: AskOption[];
  /** Answer is string[] instead of string. Only with options. */
  multiSelect?: boolean;
  /** Free text accepted even when options are given. Default true. */
  allowOther?: boolean;
}

/** question id -> answer; string[] only for multiSelect questions. */
export type AskAnswers = Record<string, string | string[]>;
