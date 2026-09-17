import type { Block } from '@textui/chat';
import type { Queued } from './types/chat.js';
import type { Turn } from './types/turn.js';

/** The block id of a queued message: `queued:<id>`; `enter` on it is `unqueue`. */
export const QUEUED_BLOCK = 'queued:';

/**
 * Turns, flattened into the rows the transcript scrolls, then what waits to be the next turns.
 *
 * A turn is a run of rows, not a box: what was said, a header, prose, a fold of reasoning, a row per
 * tool call. Flat, so the cursor can land on any of them and a four-hundred-row turn scrolls as rows.
 */
export function toBlocks(turns: Turn[], model?: string, queued: Queued[] = []): Block[] {
  const blocks: Block[] = [];
  for (const turn of turns) {
    blocks.push({ kind: 'said', id: `${turn.id}:said`, turnId: turn.id, text: turn.input });
    const running = turn.state === 'running';
    const elapsed = turn.endedAt === undefined ? undefined : Date.parse(turn.endedAt) - Date.parse(turn.startedAt);
    const named = turn.model ?? model;
    blocks.push({
      kind: 'header',
      id: `${turn.id}:head`,
      turnId: turn.id,
      ...(named !== undefined ? { model: named } : {}),
      meta: running ? 'running' : elapsed !== undefined && elapsed >= 0 ? `${(elapsed / 1000).toFixed(1)}s` : '',
      state: turn.state,
    });
    turn.parts.forEach((part, index) => {
      // The draft parts are being written (decision CLI-04.2); the last part of a running turn is drawn as such too.
      const last = running && index === turn.parts.length - 1;
      switch (part.kind) {
        case 'text': blocks.push({ kind: 'prose', id: part.id, turnId: turn.id, content: part.text, streaming: last || part.streaming === true }); break;
        case 'reasoning': blocks.push({ kind: 'reasoning', id: part.id, turnId: turn.id, content: part.text, streaming: last || part.streaming === true }); break;
        case 'tool': blocks.push({ kind: 'tool', id: part.id, turnId: turn.id, call: part.call }); break;
        case 'error': blocks.push({ kind: 'failure', id: part.id, turnId: turn.id, content: part.message, resumable: false }); break;
        case 'notice': blocks.push({ kind: 'notice', id: part.id, turnId: turn.id, content: part.text }); break;
        case 'steer': blocks.push({ kind: 'said', id: part.id, turnId: turn.id, text: part.text }); break;
        case 'summary':
          blocks.push({ kind: 'notice', id: `${part.id}:notice`, turnId: turn.id, content: compactedNotice(part) });
          blocks.push({ kind: 'prose', id: part.id, turnId: turn.id, content: part.text, streaming: false });
          break;
      }
    });
  }
  for (const waiting of queued) blocks.push({ kind: 'queued', id: `${QUEUED_BLOCK}${waiting.id}`, messageId: waiting.id, text: waiting.text });
  return blocks;
}

/** What a compaction did, with the tokens before and after when the runtime reported them (cli/03 F1, F7). */
export function compactedNotice(part: { before?: number; after?: number }): string {
  return part.before !== undefined && part.after !== undefined
    ? `Context compacted: ${part.before} tokens to ${part.after}.`
    : 'Context compacted: the conversation so far was folded into this summary; the model continues from it.';
}
