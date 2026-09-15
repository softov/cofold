import type { Block } from '@textui/chat';
import type { Turn } from './types/turn.js';

/**
 * Turns, flattened into the rows the transcript scrolls.
 *
 * A turn is a run of rows, not a box: what was said, a header, prose, a fold of reasoning, a row per
 * tool call. Flat, so the cursor can land on any of them and a four-hundred-row turn scrolls as rows.
 */
export function toBlocks(turns: Turn[], model?: string): Block[] {
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
      const last = running && index === turn.parts.length - 1;
      switch (part.kind) {
        case 'text': blocks.push({ kind: 'prose', id: part.id, turnId: turn.id, content: part.text, streaming: last }); break;
        case 'reasoning': blocks.push({ kind: 'reasoning', id: part.id, turnId: turn.id, content: part.text, streaming: last }); break;
        case 'tool': blocks.push({ kind: 'tool', id: part.id, turnId: turn.id, call: part.call }); break;
        case 'error': blocks.push({ kind: 'failure', id: part.id, turnId: turn.id, content: part.message, resumable: false }); break;
      }
    });
  }
  return blocks;
}
