import type { Trust } from '../trust.js';
/**
 * The part of the Agent Client Protocol (version 1) that `copapo acp` speaks, as the protocol's schema
 * names it (`@agentclientprotocol/sdk` 1.8.0, `schema/schema.json`). Only the fields copapo reads or
 * writes; every message may carry more, and what copapo does not know it leaves alone.
 */
import type { Readable, Writable } from 'node:stream';
import type { Chat } from './chat.js';

/** A JSON-RPC id. Absent on a notification, which is never answered. */
export type RpcId = string | number;

export interface Implementation {
  name: string;
  title?: string;
  version: string;
}

export interface ClientCapabilities {
  fs?: { readTextFile?: boolean; writeTextFile?: boolean };
  terminal?: boolean;
  /** Present when the client can show a form or open a URL the agent asks for. */
  elicitation?: { form?: object | null; url?: object | null } | null;
}

export interface InitializeRequest {
  protocolVersion: number;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: Implementation | null;
}

export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionMode[];
}

export interface SessionConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

/** A select the client draws; `category` says what it is to a client that treats some specially. */
export interface SessionConfigOption {
  type: 'select';
  id: string;
  name: string;
  description?: string;
  category?: 'mode' | 'model' | 'model_config' | 'thought_level';
  currentValue: string;
  options: SessionConfigSelectOption[];
}

/** What `session/new`, `session/load`, `session/resume` and `session/fork` answer besides an id. */
export interface SessionSetup {
  modes: SessionModeState;
  configOptions: SessionConfigOption[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'resource_link'; uri: string; name: string }
  | { type: 'image' | 'audio' | 'resource'; [key: string]: unknown };

export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type ToolCallContent = { type: 'content'; content: { type: 'text'; text: string } };

export interface ToolCall {
  toolCallId: string;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
  locations?: { path: string }[];
  rawInput?: unknown;
}

export interface ToolCallUpdate {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint: string } | null;
}

export type SessionUpdate =
  | { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk'; content: { type: 'text'; text: string } }
  | ({ sessionUpdate: 'tool_call' } & ToolCall)
  | ({ sessionUpdate: 'tool_call_update' } & ToolCallUpdate)
  | { sessionUpdate: 'available_commands_update'; availableCommands: AvailableCommand[] }
  | { sessionUpdate: 'current_mode_update'; currentModeId: string }
  | { sessionUpdate: 'config_option_update'; configOptions: SessionConfigOption[] }
  | { sessionUpdate: 'session_info_update'; title?: string | null; updatedAt?: string | null }
  | { sessionUpdate: 'usage_update'; used: number; size: number };

export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export type RequestPermissionOutcome = { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string };

/** One field of an elicitation form. */
export type ElicitationProperty =
  | { type: 'string'; title?: string; description?: string; oneOf?: { const: string; title: string }[] }
  | { type: 'array'; title?: string; description?: string; items: { anyOf: { const: string; title: string }[] } }
  | { type: 'boolean'; title?: string; description?: string; default?: boolean };

export interface ElicitationSchema {
  type: 'object';
  properties: Record<string, ElicitationProperty>;
  required?: string[];
}

export type ElicitationResponse =
  | { action: 'accept'; content?: Record<string, string | number | boolean | string[]> }
  | { action: 'decline' | 'cancel' | string };

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}

/** What `serveAcp` is built from. */
export interface AcpServerOptions {
  /**
   * The service for a session's `cwd`, built once per `cwd` and kept; `serveAcp` closes each when it ends.
   * `trusted` is the person's answer when the server asked; absent, the folder's saved trust decides.
   */
  chatFor(cwd: string, trusted?: boolean): Chat;
  /** The folder's trust, read before its service is built; absent, nothing is asked. */
  trustOf?(cwd: string): Trust;
  /** Keeps the person's answer for the folder. */
  saveTrust?(cwd: string, trusted: boolean): Promise<unknown>;
  /** The folder `session/list` lists when the client names none: `--workspace`. */
  workspace: string;
  agentInfo: Implementation;
  /** Read from; `process.stdin` by default. */
  stdin?: Readable;
  /** Written to, with protocol messages only; `process.stdout` by default. */
  stdout?: Writable;
  /** Where a fault copapo cannot answer on the wire goes; stderr by default. */
  warn?(message: string): void;
}

export interface AcpServer {
  /** Resolves once stdin has ended and every service is closed. */
  closed: Promise<void>;
}
