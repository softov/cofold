import type { CanUseTool, ModelInfo, Options, SDKMessage, SDKSessionInfo, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
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

/** The part of a `Query` the service uses; the SDK's own satisfies it, a test's fake implements it. */
export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
  supportedCommands(): Promise<SlashCommand[]>;
  close(): void;
}

/** The part of the SDK the service uses. */
export interface ClaudeSdkSubset {
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }): ClaudeQuery;
  listSessions(options?: { dir?: string }): Promise<SDKSessionInfo[]>;
  getSessionMessages(sessionId: string, options?: { dir?: string }): Promise<unknown[]>;
  deleteSession(sessionId: string, options?: { dir?: string }): Promise<void>;
}

/** What `canUseTool` handed over and is waiting on: the person's decision resolves it. */
export interface ClaudeDecision {
  requestId: string;
  /** The `tool_use` block's id, as the store names the call; the confirmation is shown on it. */
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions: NonNullable<Parameters<CanUseTool>[2]['suggestions']>;
  resolve(result: Awaited<ReturnType<CanUseTool>>): void;
}
