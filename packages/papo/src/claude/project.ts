import type { Usage } from '@cofold/agents';
import type { ChatPendingInput, ChatToolCall } from '@textui/chat';
import { COMPACTED_INPUT, inputLine } from '../turns.js';
import type { ClaudeBlock, ClaudeLive, ClaudeSessionMessage, ClaudeUsage } from '../types/claude.js';
import type { Turn } from '../types/turn.js';

const COMMAND = /<command-name>([^<]*)<\/command-name>(?:\s*<command-message>[^<]*<\/command-message>)?(?:\s*<command-args>([^<]*)<\/command-args>)?/;
const COMMAND_OUTPUT = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;
/** What the CLI writes into the transcript when a turn is interrupted (also `... for tool use`). */
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/;

/**
 * A Claude Code session as papo's turns (CLI-03 decision 4). A top-level user message with text
 * starts a turn; the assistant's blocks become the parts; a `tool_result` closes its call. What the
 * store cannot say (running, waiting, failed) comes from `live`, this process's knowledge.
 *
 * The CLI's view of its own history is not chronological after a compaction: the summary is the
 * first message, the retained tail follows, then the `/compact` echo. Projected as it is read.
 */
export function projectSession(messages: ClaudeSessionMessage[], live: ClaudeLive): { turns: Turn[]; pending: ChatPendingInput | null } {
  const turns: Turn[] = [];
  const calls = new Map<string, ChatToolCall>();
  /** The API message ids already counted: the CLI stores one entry per block of a reply, all sharing the id (review R1). */
  const counted = new Set<string>();
  let current: Turn | undefined;
  const open = (message: ClaudeSessionMessage, input: string): Turn => {
    current = { id: message.uuid, input, parts: [], state: 'complete', startedAt: message.timestamp ?? '', usage: { inputTokens: 0, outputTokens: 0 }, steps: 0 };
    turns.push(current);
    return current;
  };

  for (const message of messages) {
    if (message.parent_tool_use_id !== null) continue;
    const blocks = blocksOf(message);
    if (message.type === 'user') {
      if (message.isCompactSummary === true) {
        const turn = open(message, COMPACTED_INPUT);
        turn.parts.push({ kind: 'summary', id: message.uuid, text: textOf(blocks) });
        continue;
      }
      const results = blocks.filter((block): block is Extract<ClaudeBlock, { type: 'tool_result' }> => block.type === 'tool_result');
      if (results.length > 0) {
        for (const result of results) {
          const call = calls.get(result.tool_use_id);
          if (call === undefined) continue;
          call.status = result.is_error === true ? 'failed' : 'completed';
          call.output = resultText(result.content);
        }
        if (current !== undefined && message.timestamp !== undefined) current.endedAt = message.timestamp;
        continue;
      }
      const text = textOf(blocks);
      const output = COMMAND_OUTPUT.exec(text);
      const notice = output !== null ? output[1]!.trim() : INTERRUPTED.test(text) ? text.slice(1, -1) : undefined;
      if (notice !== undefined && current !== undefined) {
        current.parts.push({ kind: 'notice', id: message.uuid, text: notice });
        if (message.timestamp !== undefined) current.endedAt = message.timestamp;
        continue;
      }
      const command = COMMAND.exec(text);
      open(message, command !== null ? `${command[1]!.trim()}${command[2]?.trim() ? ` ${command[2].trim()}` : ''}` : text);
      continue;
    }
    if (message.type !== 'assistant') continue;
    const turn = current ?? open(message, '');
    // A reply split across entries is one step with one usage; an entry without an id counts on its own.
    const replyId = message.message.id;
    if (replyId === undefined || !counted.has(replyId)) {
      if (replyId !== undefined) counted.add(replyId);
      turn.steps += 1;
      turn.usage = add(turn.usage, message.message.usage);
    }
    if (message.timestamp !== undefined) turn.endedAt = message.timestamp;
    for (const [index, block] of blocks.entries()) {
      const id = `${message.uuid}:${index}`;
      if (block.type === 'text') { if (block.text.trim() !== '') turn.parts.push({ kind: 'text', id, text: block.text }); }
      else if (block.type === 'thinking') turn.parts.push({ kind: 'reasoning', id, text: block.thinking });
      else if (block.type === 'tool_use') {
        const call: ChatToolCall = { id: block.id, name: block.name, status: 'running', input: inputLine({ input: block.input, raw: '' }) };
        calls.set(block.id, call);
        turn.parts.push({ kind: 'tool', id: block.id, call });
      }
    }
  }

  const last = turns.at(-1);
  if (last !== undefined) {
    if (live.running) { last.state = 'running'; delete last.endedAt; }
    const error = live.errors?.[last.id];
    if (error !== undefined && !live.running) { last.state = 'failed'; last.parts.push({ kind: 'error', id: `${last.id}:error`, message: error }); }
  }
  // Calls still without a result: waiting on the person, running, or left behind by a turn that ended.
  for (const call of calls.values()) {
    if (call.status !== 'running') continue;
    call.status = live.pending?.kind === 'toolConfirmation' && live.pending.call.id === call.id ? 'pending-confirmation' : live.running ? 'running' : 'cancelled';
  }
  return { turns, pending: live.running ? live.pending : null };
}

function blocksOf(message: ClaudeSessionMessage): ClaudeBlock[] {
  const { content } = message.message;
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

function textOf(blocks: ClaudeBlock[]): string {
  return blocks.filter((block): block is Extract<ClaudeBlock, { type: 'text' }> => block.type === 'text').map((block) => block.text).join('\n').trim();
}

function resultText(content: string | { type: string; text?: string }[]): string {
  return typeof content === 'string' ? content : content.map((block) => block.text ?? `[${block.type}]`).join('\n');
}

/** The CLI's counts as papo's: cached input is input the model read. */
function add(usage: Usage, reported: ClaudeUsage | undefined): Usage {
  if (reported === undefined) return usage;
  return {
    inputTokens: usage.inputTokens + reported.input_tokens + (reported.cache_read_input_tokens ?? 0) + (reported.cache_creation_input_tokens ?? 0),
    outputTokens: usage.outputTokens + reported.output_tokens,
  };
}

/** The user message the CLI stores for a slash command; what `say('/compact')` is echoed as. */
export function isCommandEcho(text: string): boolean {
  return COMMAND.test(text);
}
