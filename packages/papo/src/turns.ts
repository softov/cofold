import type { ApprovalPayload, InputPayload, Message, PendingRequest, RunRecord, ToolCallPart } from '@facio/agents';
import { textOf } from '@facio/agents';
import type { ChatPendingInput, ChatToolCall } from '@textui/chat';
import { toChatQuestion } from './questions.js';
import type { Turn, TurnPart, TurnState } from './types/turn.js';

export interface ProjectionInput {
  /** The session's transcript, in order. */
  messages: Message[];
  /** Every run of the session, oldest first. */
  runs: RunRecord[];
  /** The newest run's request while it is `awaiting`. */
  pending?: PendingRequest | undefined;
  /** Why a failed run failed, by run id; the store keeps it on the run's last event. */
  errors?: Record<string, string>;
}

/** The option a confirmation offers beyond yes and no; the harness remembers it for the session. */
export const ALWAYS = 'always';

/**
 * The transcript as turns: one per run, each holding what was asked and what came back.
 *
 * A run's messages are the slice from its input message up to the next run's; the loop is the only
 * appender, so the order on disk is the order of the conversation. A tool call's status is read
 * from whether its result arrived, and if not, from what the run is doing now.
 */
export function projectTurns(input: ProjectionInput): { turns: Turn[]; pending: ChatPendingInput | null } {
  const { messages, runs } = input;
  const at = new Map(messages.map((message, index) => [message.id, index]));
  const turns: Turn[] = [];
  let pending: ChatPendingInput | null = null;

  runs.forEach((run, index) => {
    const start = run.inputMessageId === undefined ? undefined : at.get(run.inputMessageId);
    const next = runs[index + 1]?.inputMessageId;
    const end = next === undefined ? messages.length : (at.get(next) ?? messages.length);
    const slice = start === undefined ? [] : messages.slice(start, end);
    const state = stateOf(run);
    const waiting = input.pending?.runId === run.runId ? input.pending : undefined;

    const parts: TurnPart[] = [];
    const calls = new Map<string, ChatToolCall>();
    let text = '';
    for (const message of slice) {
      if (message.role === 'user' && (message.source === 'input' || message.source === 'system')) { text = textOf(message); continue; }
      if (message.source === 'summary') { parts.push({ kind: 'summary', id: message.id, text: textOf(message) }); continue; }
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
    if (run.status === 'failed') {
      parts.push({ kind: 'error', id: `${run.runId}:error`, message: input.errors?.[run.runId] ?? 'The run failed.' });
    }

    turns.push({
      id: run.runId,
      input: text,
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

function stateOf(run: RunRecord): TurnState {
  switch (run.status) {
    case 'running': case 'awaiting': return 'running';
    case 'completed': return 'complete';
    case 'failed': return 'failed';
    case 'stopped': case 'cancelled': return 'cancelled';
  }
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
  const text = first === undefined ? '' : textOf(first).replace(/\s+/g, ' ').trim();
  if (text === '') return fallback;
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}
