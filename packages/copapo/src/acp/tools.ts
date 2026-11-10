import type { ChatToolCall, ChatToolCallStatus } from '@textui/chat';
import type { ToolCallStatus, ToolKind } from '../types/acp.js';

/**
 * What a tool does, as ACP names it, for the tools of both backends: `@cofold/tools` and Claude Code's.
 * Neither declares an ACP kind, so the name decides; a tool not listed is `other`.
 */
const KINDS: Readonly<Record<string, ToolKind>> = {
  read_file: 'read', memory_read: 'read', Read: 'read', NotebookRead: 'read',
  write_file: 'edit', edit_file: 'edit', memory_write: 'edit', Write: 'edit', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  list_files: 'search', search_files: 'search', Glob: 'search', Grep: 'search', LS: 'search',
  shell_exec: 'execute', Bash: 'execute', BashOutput: 'execute', KillShell: 'execute',
  web_fetch: 'fetch', web_search: 'fetch', WebFetch: 'fetch', WebSearch: 'fetch',
  TodoWrite: 'think', Task: 'think',
  ExitPlanMode: 'switch_mode',
};

export function kindOf(name: string): ToolKind {
  return KINDS[name] ?? 'other';
}

/** The longest input a title carries; the whole input is the call's `rawInput`. */
const TITLE_INPUT = 80;

/** The row's title: the tool and what it was given, on one line. */
export function titleOf(call: Pick<ChatToolCall, 'name' | 'input'>): string {
  const input = (call.input ?? '').replace(/\s+/g, ' ').trim();
  if (input === '' || input === '{}') return call.name;
  return `${call.name} ${input.length > TITLE_INPUT ? `${input.slice(0, TITLE_INPUT - 1)}…` : input}`;
}

export function statusOf(status: ChatToolCallStatus): ToolCallStatus {
  switch (status) {
    case 'pending': case 'pending-confirmation': return 'pending';
    case 'running': return 'in_progress';
    case 'completed': return 'completed';
    case 'failed': case 'cancelled': return 'failed';
  }
}
