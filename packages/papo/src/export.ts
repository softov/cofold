import { join } from 'node:path';
import type { Snapshot, Turn } from './types/turn.js';

/**
 * A conversation as Markdown: what was said, what came back, which tools ran. For a file a person
 * keeps or pastes, so tool calls are one line each and reasoning is left out.
 */
export function toMarkdown(snapshot: Snapshot): string {
  const { session, settings } = snapshot;
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `Session \`${session.id}\` · model \`${settings.model || 'first listed'}\` · permissions ${settings.permissions} · thinking ${settings.reasoning}`,
    '',
  ];
  for (const turn of snapshot.turns) lines.push(...turnLines(turn), '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function turnLines(turn: Turn): string[] {
  const lines = ['## You', '', turn.input.trim(), '', '## papo', ''];
  let said = false;
  for (const part of turn.parts) {
    if (part.kind === 'text') { lines.push(part.text.trim(), ''); said = true; }
    else if (part.kind === 'tool') {
      const input = part.call.input === undefined || part.call.input === '' ? '' : `(${part.call.input})`;
      lines.push(`- \`${part.call.name}${input}\` → ${part.call.status}`, '');
      said = true;
    } else if (part.kind === 'error') { lines.push(`> Failed: ${part.message}`, ''); said = true; }
  }
  if (!said) lines.push(turn.state === 'running' ? '_(running)_' : '_(nothing said)_', '');
  return lines;
}

/** Where `/export` and `session export` write when no path is given. */
export function exportPath(workspace: string, sessionId: string): string {
  return join(workspace, `papo-${sessionId}.md`);
}
