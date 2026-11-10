import { describe, expect, it } from 'vitest';
import type { Snapshot, Turn, TurnPart } from '../types/turn.js';
import { baseline, emptySent, project } from './project.js';

const turn = (parts: TurnPart[], overrides: Partial<Turn> = {}): Turn => ({
  id: 'run-1', input: 'Hi', parts, state: 'running', startedAt: 'now', usage: { inputTokens: 0, outputTokens: 0 }, steps: 0, ...overrides,
});
const snapshot = (turns: Turn[]): Snapshot => ({
  session: { id: 's', title: 'Hi', activity: 'running', createdAt: 'now', updatedAt: 'now' },
  settings: { model: 'fake/m', permissions: 'default', reasoning: 'off', autoCompact: false },
  turns, pending: null, running: true, queued: [],
});
const chunks = (updates: { sessionUpdate: string; content?: { text: string } }[]): [string, string | undefined][] =>
  updates.map((one) => [one.sessionUpdate, one.content?.text]);

describe('project', () => {
  it('sends a draft as it grows, and nothing again when the stored message takes its place', () => {
    let sent = emptySent();
    const steps = [
      [{ kind: 'reasoning', id: 'run-1:draft:reasoning', text: 'Thin', streaming: true }, { kind: 'text', id: 'run-1:draft:text', text: '', streaming: true }],
      [{ kind: 'reasoning', id: 'run-1:draft:reasoning', text: 'Thinking', streaming: true }, { kind: 'text', id: 'run-1:draft:text', text: 'Hel', streaming: true }],
      [{ kind: 'reasoning', id: 'm1:0', text: 'Thinking' }, { kind: 'text', id: 'm1:1', text: 'Hello' }],
    ] as TurnPart[][];
    const seen: [string, string | undefined][] = [];
    for (const parts of steps) {
      const out = project(snapshot([turn(parts)]), sent);
      sent = out.sent;
      seen.push(...chunks(out.updates as never));
    }
    expect(seen).toEqual([['agent_thought_chunk', 'Thin'], ['agent_thought_chunk', 'king'], ['agent_message_chunk', 'Hel'], ['agent_message_chunk', 'lo']]);
  });

  it('does not send the draft again while the stored message and the draft are both in the turn', () => {
    let sent = emptySent();
    const seen: [string, string | undefined][] = [];
    const steps = [
      [{ kind: 'text', id: 'run-1:draft:text', text: 'In the fork.', streaming: true }],
      [{ kind: 'text', id: 'm1:0', text: 'In the fork.' }, { kind: 'text', id: 'run-1:draft:text', text: 'In the fork.', streaming: true }],
      [{ kind: 'text', id: 'm1:0', text: 'In the fork.' }],
      [{ kind: 'text', id: 'm1:0', text: 'In the fork.' }, { kind: 'text', id: 'run-1:draft:text', text: 'In', streaming: true }],
      [{ kind: 'text', id: 'm1:0', text: 'In the fork.' }, { kind: 'text', id: 'run-1:draft:text', text: 'Indeed', streaming: true }],
    ] as TurnPart[][];
    for (const parts of steps) {
      const out = project(snapshot([turn(parts)]), sent);
      sent = out.sent;
      seen.push(...chunks(out.updates as never));
    }
    // The last two are a new step's draft: held back while it reads as the old text, then sent whole from its own place.
    expect(seen).toEqual([['agent_message_chunk', 'In the fork.'], ['agent_message_chunk', 'Indeed']]);
  });

  it('sends a tool call once, then each change of its status or output', () => {
    const call = (status: 'running' | 'pending-confirmation' | 'completed', output?: string): TurnPart =>
      ({ kind: 'tool', id: 'c1', call: { id: 'c1', name: 'read_file', status, input: 'a.txt', ...(output !== undefined ? { output } : {}) } });
    let sent = emptySent();
    const all: unknown[] = [];
    for (const part of [call('running'), call('running'), call('pending-confirmation'), call('completed', 'text of a')]) {
      const out = project(snapshot([turn([part])]), sent);
      sent = out.sent;
      all.push(...out.updates);
    }
    expect(all).toEqual([
      { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'read_file a.txt', kind: 'read', status: 'in_progress', rawInput: 'a.txt' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'pending' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'text of a' } }] },
    ]);
  });

  it('replays the inputs and the steers only when asked, and sends a notice as the agent', () => {
    const parts: TurnPart[] = [{ kind: 'text', id: 'm1:0', text: 'Sure.' }, { kind: 'steer', id: 'u2', text: 'And this' }, { kind: 'notice', id: 'n1', text: 'Context compacted.' }];
    const live = project(snapshot([turn(parts)]), emptySent());
    expect(chunks(live.updates as never)).toEqual([['agent_message_chunk', 'Sure.'], ['agent_message_chunk', 'Context compacted.']]);
    const replay = project(snapshot([turn(parts)]), emptySent(), { replay: true });
    expect(chunks(replay.updates as never)).toEqual([['user_message_chunk', 'Hi'], ['agent_message_chunk', 'Sure.'], ['user_message_chunk', 'And this'], ['agent_message_chunk', 'Context compacted.']]);
  });

  it('starts a resume from what the store holds, so only what follows is sent', () => {
    const before = snapshot([turn([{ kind: 'text', id: 'm1:0', text: 'Old.' }], { state: 'complete' })]);
    const sent = baseline(before);
    const after = snapshot([...before.turns, turn([{ kind: 'text', id: 'm2:0', text: 'New.' }], { id: 'run-2', input: 'Again' })]);
    expect(chunks(project(after, sent).updates as never)).toEqual([['agent_message_chunk', 'New.']]);
  });
});
