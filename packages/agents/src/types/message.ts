export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart { type: 'text'; text: string }
export interface ImagePart {
  type: 'image';
  mimeType: string;
  /** Exactly one of `data` (base64) or `url`. */
  data?: string;
  url?: string;
}
/** Model reasoning (thinking) text. Never sent back to a model; textOf() ignores it. */
export interface ReasoningPart { type: 'reasoning'; text: string }
export interface ToolCallPart {
  type: 'toolCall';
  /** Model-supplied id when present, otherwise newId(). Pairs with ToolResultPart.callId. */
  callId: string;
  name: string;
  /** Parsed arguments; undefined when `raw` did not parse as JSON. */
  input: unknown;
  /** The argument string exactly as the model produced it. */
  raw: string;
}
export interface ToolResultPart {
  type: 'toolResult';
  callId: string;
  name: string;
  /** What the model sees. Already bounded and, if a hook transformed it, the transformed value. */
  content: string;
  isError: boolean;
}
export type ContentPart = TextPart | ImagePart | ReasoningPart | ToolCallPart | ToolResultPart;

/** Where a message came from; kept so context assembly can tell instructions, input, tool output and summaries apart. */
export type MessageSource = 'input' | 'model' | 'tool' | 'hook' | 'summary' | 'system';

export interface Message {
  id: string;
  role: Role;
  parts: ContentPart[];
  source: MessageSource;
  createdAt: string;
}
