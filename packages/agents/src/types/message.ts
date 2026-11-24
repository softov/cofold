export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * When a part was produced, as ISO 8601 strings. A model part runs from its first streamed delta to its last, or
 * spans the whole model call when the reply did not stream; a tool result runs while its tool executed. Absent on a
 * part written before the run kept times. Never sent to a model.
 */
export interface PartTimes {
  startedAt?: string;
  endedAt?: string;
}

export interface TextPart extends PartTimes { type: 'text'; text: string }
export interface ImagePart extends PartTimes {
  type: 'image';
  mimeType: string;
  /** Exactly one of `data` (base64) or `url`. */
  data?: string;
  url?: string;
}
/** Model reasoning (thinking) text. Never sent back to a model; textOf() ignores it. */
export interface ReasoningPart extends PartTimes { type: 'reasoning'; text: string }
export interface ToolCallPart extends PartTimes {
  type: 'toolCall';
  /** Model-supplied id when present, otherwise newId(). Pairs with ToolResultPart.callId. */
  callId: string;
  name: string;
  /** Parsed arguments; undefined when `raw` did not parse as JSON. */
  input: unknown;
  /** The argument string exactly as the model produced it. */
  raw: string;
}
export interface ToolResultPart extends PartTimes {
  type: 'toolResult';
  callId: string;
  name: string;
  /** What the model sees. Already bounded and, if a hook transformed it, the transformed value. */
  content: string;
  isError: boolean;
}
export type ContentPart = TextPart | ImagePart | ReasoningPart | ToolCallPart | ToolResultPart;

/** Where a message came from; kept so context assembly can tell instructions, input, tool output and summaries apart. */
export type MessageSource =
  | 'input' | 'model' | 'tool' | 'hook' | 'summary' | 'system'
  /** The slash line of a runtime command, as typed; never in a request. */
  | 'command'
  /** A runtime command's output; never in a request. */
  | 'notice'
  /** A prompt command's expanded text, after the typed line; the model reads it like input. */
  | 'skill';

export interface Message {
  id: string;
  role: Role;
  parts: ContentPart[];
  source: MessageSource;
  createdAt: string;
  /**
   * On a `summary` message: the ids of the messages it stands for (older summaries included), which
   * a request no longer carries. The originals stay on disk.
   */
  summarizes?: string[];
}
