import type { ApprovalPayload, InputPayload, Message, PendingRequest, RunRecord, StopReason, ToolCallPart } from '@facio/agents';
import { INTERRUPTED, ZERO_USAGE, textOf } from '@facio/agents';
import type { ChatPendingInput, ChatToolCall } from '@textui/chat';
import { toChatQuestion } from './questions.js';
import type { Compaction, Draft, Turn, TurnPart, TurnState } from './types/turn.js';

export interface ProjectionInput {
  /** The messages to show, in order: the model's view (`contextOf`) for the screen, the whole transcript for `session show --all`. */
  messages: Message[];
  /** Every run of the session, oldest first. */
  runs: RunRecord[];
  /** The newest run's request while it is `awaiting`. */
  pending?: PendingRequest | undefined;
  /** Why a failed run failed, by run id; the store keeps it on the run's last event. */
  errors?: Record<string, string>;
  /** Why a stopped run stopped, by run id (decision 97): `hook` ended on purpose, the rest are limits. */
  stopped?: Record<string, StopReason>;
  /** What each compaction did, by the summary message's id (cli/03 F1, F7). */
  compactions?: Record<string, Compaction>;
  /** The step being written by the run attached here, when one is (decision CLI-04.2). */
  draft?: Draft;
}

/** The option a confirmation offers beyond yes and no; the harness remembers it for the session. */
export const ALWAYS = 'always';

/** What a compaction turn says it was asked: the ask itself is covered by the summary; the Claude backend shows the same words. */
export const COMPACTED_INPUT = '(context compacted)';

/**
 * The transcript as turns: one per run, each holding what was asked and what came back.
 *
 * A run is placed where its input message is; its messages are the slice from there up to the next
 * placed run's input. The loop is the only appender, so the order on disk is the order of the
 * conversation, and the model's view (`contextOf`, cli/03 F1) keeps it but for the newest summary,
 * which it moves to the front: what comes before the first placed run is that summary, shown as a
 * turn of its own, the way the Claude backend shows the CLI's. A run whose input the summary covers
 * is not shown; `session show --all` passes the whole transcript and shows everything. A tool call's
 * status is read from whether its result arrived, and if not, from what the run is doing now.
 */
export function projectTurns(input: ProjectionInput): { turns: Turn[]; pending: ChatPendingInput | null } {
  const { messages, runs } = input;
  const at = new Map(messages.map((message, index) => [message.id, index]));
  const covered = new Set(messages.flatMap((message) => message.summarizes ?? []));
  const turns: Turn[] = [];
  let pending: ChatPendingInput | null = null;

  const anchors = runs.map((run) => (run.inputMessageId === undefined ? undefined : at.get(run.inputMessageId)));
  const placed = anchors.filter((anchor): anchor is number => anchor !== undefined);
  const placedRuns = new Set(runs.filter((_run, index) => anchors[index] !== undefined).map((run) => run.runId));
  const summaryPart = (message: Message): TurnPart => {
    const compaction = input.compactions?.[message.id];
    return { kind: 'summary', id: message.id, text: textOf(message), ...(compaction !== undefined ? { before: compaction.before, after: compaction.after } : {}) };
  };

  // Before the first placed run: the summary the view starts with, as the compaction's turn. Its run is the one
  // whose `context.compacted` named it when that run has no place of its own (a `compact()` run, its ask covered);
  // an auto-compaction's run keeps its place below, and the summary turn stands on the message alone.
  for (const message of messages.slice(0, placed.length > 0 ? Math.min(...placed) : messages.length)) {
    if (message.source !== 'summary') continue;
    const compaction = input.compactions?.[message.id];
    const owner = compaction !== undefined && !placedRuns.has(compaction.runId) ? runs.find((run) => run.runId === compaction.runId) : undefined;
    turns.push({
      id: owner?.runId ?? message.id,
      input: COMPACTED_INPUT,
      parts: [summaryPart(message)],
      state: owner === undefined ? 'complete' : stateOf(owner, input.stopped?.[owner.runId]),
      startedAt: owner?.createdAt ?? message.createdAt,
      endedAt: owner?.updatedAt ?? message.createdAt,
      usage: owner?.usage ?? ZERO_USAGE,
      steps: owner?.steps ?? 0,
    });
  }

  runs.forEach((run, index) => {
    const start = anchors[index];
    // Covered by a summary: the model no longer sees it, so neither does the screen.
    if (start === undefined && run.inputMessageId !== undefined && covered.has(run.inputMessageId)) return;
    const end = start === undefined ? 0 : anchors.slice(index + 1).find((anchor) => anchor !== undefined) ?? messages.length;
    const slice = start === undefined ? [] : messages.slice(start, end);
    const stopped = input.stopped?.[run.runId];
    const state = stateOf(run, stopped);
    const waiting = input.pending?.runId === run.runId ? input.pending : undefined;

    const parts: TurnPart[] = [];
    const calls = new Map<string, ChatToolCall>();
    let text: string | undefined;
    for (const message of slice) {
      if (message.role === 'user' && (message.source === 'input' || message.source === 'system')) {
        // The first is the turn's input; a later input is a steer (decision 95), shown where it landed; a later
        // system line is the runtime's, the interrupt marker (cli/03 F4) shown as the Claude backend shows the CLI's.
        if (text === undefined) text = textOf(message);
        else if (message.source === 'input') parts.push({ kind: 'steer', id: message.id, text: textOf(message) });
        else parts.push({ kind: 'notice', id: message.id, text: noticeOf(textOf(message)) });
        continue;
      }
      if (message.source === 'summary') { parts.push(summaryPart(message)); continue; }
      for (const part of message.parts) {
        if (part.type === 'reasoning') parts.push({ kind: 'reasoning', id: `${message.id}:${parts.length}`, text: part.text });
        else if (part.type === 'text' && message.role === 'assistant') parts.push({ kind: 'text', id: `${message.id}:${parts.length}`, text: part.text });
        else if (part.type === 'toolCall') {
          const call = callOf(part, run, waiting);
          calls.set(part.callId, call);
          parts.push({ kind: 'tool', id: part.callId, call });
        } else if (part.type === 'toolResult') {
          const call = calls.get(part.callId);
          if (call === undefined) continue;
          call.status = part.isError ? 'failed' : 'completed';
          call.output = part.content;
        }
      }
    }
    // The step being written, after what the store holds of the turn; its ids never collide with a stored message's.
    if (input.draft?.runId === run.runId) {
      const { draft } = input;
      if (draft.reasoning !== '') parts.push({ kind: 'reasoning', id: `${run.runId}:draft:reasoning`, text: draft.reasoning, streaming: true });
      parts.push({ kind: 'text', id: `${run.runId}:draft:text`, text: draft.text, streaming: true });
    }
    if (state === 'failed') {
      const why = input.errors?.[run.runId] ?? (run.status === 'stopped' ? `stopped${stopped !== undefined ? `: ${stopped}` : ''}` : 'The run failed.');
      parts.push({ kind: 'error', id: `${run.runId}:error`, message: why });
    }

    turns.push({
      id: run.runId,
      input: text ?? '',
      parts,
      state,
      startedAt: run.createdAt,
      ...(state === 'running' ? {} : { endedAt: run.updatedAt }),
      usage: run.usage,
      steps: run.steps,
    });

    if (waiting !== undefined && run.status === 'awaiting') pending = pendingOf(waiting, calls);
  });

  return { turns, pending };
}

/**
 * How a run reads as a turn (decision 97): a `stopped` run ended by a hook finished on purpose and is complete;
 * one stopped by a limit did not get to answer and is failed, the error part naming the limit.
 */
function stateOf(run: RunRecord, stopped: StopReason | undefined): TurnState {
  switch (run.status) {
    case 'running': case 'awaiting': return 'running';
    case 'completed': return 'complete';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'stopped': return stopped === 'hook' ? 'complete' : 'failed';
  }
}

/** The runtime's line as the screen says it: the interrupt marker without its brackets, as the Claude backend strips the CLI's. */
function noticeOf(text: string): string {
  return text === INTERRUPTED ? text.slice(1, -1) : text;
}

/** A tool call with no result yet: what the run is doing says what the row shows. */
function callOf(part: ToolCallPart, run: RunRecord, waiting: PendingRequest | undefined): ChatToolCall {
  const call: ChatToolCall = { id: part.callId, name: part.name, status: 'running', input: inputLine(part) };
  if (run.status === 'awaiting' && waiting?.callId === part.callId) {
    if (waiting.kind === 'approval') {
      const payload = waiting.payload as ApprovalPayload;
      call.status = 'pending-confirmation';
      call.confirmationTitle = payload.prompt ?? `Run ${part.name}?`;
      call.options = [{ id: ALWAYS, label: 'Always, this session' }];
    }
  } else if (run.status !== 'running' && run.status !== 'awaiting') {
    call.status = 'cancelled';
  }
  return call;
}

/** The arguments on one line: the only thing separating twenty calls of the same tool. */
export function inputLine(part: Pick<ToolCallPart, 'input' | 'raw'>): string {
  if (part.input === undefined) return part.raw;
  if (typeof part.input === 'string') return part.input;
  return JSON.stringify(part.input);
}

function pendingOf(request: PendingRequest, calls: Map<string, ChatToolCall>): ChatPendingInput {
  if (request.kind === 'approval') {
    const payload = request.payload as ApprovalPayload;
    const call = (request.callId !== undefined ? calls.get(request.callId) : undefined) ?? {
      id: request.callId ?? request.requestId,
      name: payload.name,
      status: 'pending-confirmation' as const,
      input: inputLine({ input: payload.input, raw: '' }),
      confirmationTitle: payload.prompt ?? `Run ${payload.name}?`,
      options: [{ id: ALWAYS, label: 'Always, this session' }],
    };
    return { kind: 'toolConfirmation', id: request.requestId, call };
  }
  const payload = request.payload as InputPayload;
  return {
    kind: 'chatInput',
    id: request.requestId,
    message: `${payload.name} is asking`,
    questions: payload.questions.map(toChatQuestion),
  };
}

/** The catalogue title: the first thing said, shortened to one line. */
export function titleOf(messages: Message[], fallback: string): string {
  const first = messages.find((message) => message.role === 'user' && message.source === 'input');
  return shortTitle(first === undefined ? '' : textOf(first), fallback);
}

/** One line of at most sixty characters out of a text; the fallback when there is no text. */
export function shortTitle(text: string, fallback: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return fallback;
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
