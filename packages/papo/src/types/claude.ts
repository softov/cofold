import type { ChatPendingInput } from '@textui/chat';

/**
 * The Claude Code session record as `getSessionMessages` returns it (its `message` is typed `unknown`
 * by the SDK). Only what the projection reads; read from real sessions (CLI-03 recon).
 */
export interface ClaudeSessionMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  message: ClaudeMessage;
  /** Set on subagent traffic; the main conversation has null. */
  parent_tool_use_id: string | null;
  /** The summary the CLI wrote when it compacted; the messages before it are gone from the view. */
  isCompactSummary?: boolean;
  timestamp?: string;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeBlock[];
  usage?: ClaudeUsage;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | { type: string; text?: string }[]; is_error?: boolean };

/** What this process knows about a session the CLI is working on: the store alone cannot say it. */
export interface ClaudeLive {
  running: boolean;
  /** The block the person must answer, from `canUseTool`; null when nothing waits. */
  pending: ChatPendingInput | null;
  /** The turn that failed, as the CLI's result said, keyed by the turn's input uuid. */
  errors?: Record<string, string>;
}
