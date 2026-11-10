import type { SessionUpdate, ToolCallContent, ToolCallStatus } from '../types/acp.js';
import type { Snapshot, Turn } from '../types/turn.js';
import { kindOf, statusOf, titleOf } from './tools.js';

/**
 * What a client has been sent of one session, so the next snapshot gives only what is new.
 *
 * Text and reasoning are kept by their place among the turn's parts of that kind, not by part id:
 * the reply being written is the turn's last text part under a draft id, and the stored message
 * that replaces it takes the same place under another id. Kept by place, the two are one stream.
 */
export interface Sent {
  turns: Map<string, TurnSent>;
}

interface TurnSent {
  text: string[];
  reasoning: string[];
  tools: Map<string, { status: ToolCallStatus; output: string | undefined }>;
  /** Steers, notices and summaries already sent, by part id. */
  lines: Set<string>;
}

export function emptySent(): Sent {
  return { turns: new Map() };
}

/**
 * The updates that bring a client from `sent` to `snapshot`, and what it has been sent then.
 *
 * `replay` is for `session/load`: a turn's input and its steers go out as the person's messages.
 * Without it they are left out, because the client sent them. A text that changed in place rather
 * than grew is not sent again: ACP's chunks only append.
 */
export function project(snapshot: Snapshot, sent: Sent, options: { replay?: boolean } = {}): { updates: SessionUpdate[]; sent: Sent } {
  const updates: SessionUpdate[] = [];
  const turns = new Map(sent.turns);
  for (const turn of snapshot.turns) {
    const before = turns.get(turn.id);
    const now = projectTurn(turn, before, options.replay === true, updates);
    turns.set(turn.id, now);
  }
  return { updates, sent: { turns } };
}

/** Everything in the snapshot counted as sent, and nothing sent: where `session/resume` starts. */
export function baseline(snapshot: Snapshot): Sent {
  return project(snapshot, emptySent()).sent;
}

function projectTurn(turn: Turn, before: TurnSent | undefined, replay: boolean, out: SessionUpdate[]): TurnSent {
  const now: TurnSent = before === undefined
    ? { text: [], reasoning: [], tools: new Map(), lines: new Set() }
    : { text: [...before.text], reasoning: [...before.reasoning], tools: new Map(before.tools), lines: new Set(before.lines) };
  if (before === undefined && replay && turn.input !== '') {
    out.push({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: turn.input } });
  }
  let text = 0;
  let reasoning = 0;
  /** The last stored text and reasoning of the turn, so a draft that is still their copy is known. */
  const stored = { text: '', reasoning: '' };
  for (const part of turn.parts) {
    switch (part.kind) {
      case 'text': case 'reasoning': {
        // The store holds the step's message a moment before the draft is dropped, and the draft then follows
        // its own copy. A draft that is the start of the stored text is that text; a new step's draft that only
        // looks like it is sent once it grows past it, from its own place.
        if (part.streaming === true && part.text !== '' && stored[part.kind].startsWith(part.text)) break;
        if (part.streaming !== true) stored[part.kind] = part.text;
        if (part.kind === 'text') grow(now.text, text++, part.text, 'agent_message_chunk', out);
        else grow(now.reasoning, reasoning++, part.text, 'agent_thought_chunk', out);
        break;
      }
      case 'tool': {
        const { call } = part;
        const status = statusOf(call.status);
        const output = call.output;
        const held = now.tools.get(call.id);
        const content: ToolCallContent[] | undefined = output !== undefined && output !== '' ? [{ type: 'content', content: { type: 'text', text: output } }] : undefined;
        if (held === undefined) {
          out.push({
            sessionUpdate: 'tool_call',
            toolCallId: call.id,
            title: titleOf(call),
            kind: kindOf(call.toolName ?? call.name),
            status,
            ...(call.input !== undefined ? { rawInput: call.input } : {}),
            ...(content !== undefined ? { content } : {}),
          });
        } else if (held.status !== status || held.output !== output) {
          out.push({ sessionUpdate: 'tool_call_update', toolCallId: call.id, status, ...(content !== undefined && held.output !== output ? { content } : {}) });
        }
        now.tools.set(call.id, { status, output });
        break;
      }
      case 'steer':
        if (!now.lines.has(part.id) && replay) out.push({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: part.text } });
        now.lines.add(part.id);
        break;
      case 'notice': case 'summary':
        // What a runtime command printed (`/context`, `/compact`) is the agent's answer to the line.
        if (!now.lines.has(part.id)) out.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: part.text } });
        now.lines.add(part.id);
        break;
      case 'error':
        // A failed turn's message is the prompt's error, not a chunk.
        break;
    }
  }
  return now;
}

/** The new end of the text at `place`, sent as one chunk; nothing when it did not grow. */
function grow(held: string[], place: number, text: string, kind: 'agent_message_chunk' | 'agent_thought_chunk', out: SessionUpdate[]): void {
  const before = held[place] ?? '';
  if (text.length > before.length && text.startsWith(before)) {
    out.push({ sessionUpdate: kind, content: { type: 'text', text: text.slice(before.length) } });
    held[place] = text;
  } else if (!before.startsWith(text)) {
    // Rewritten rather than grown: ACP cannot take a chunk back, so the new text is only remembered.
    held[place] = text;
  }
}
