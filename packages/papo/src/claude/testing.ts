import { randomUUID } from 'node:crypto';
import type { ModelInfo, Options, PermissionMode, PermissionResult, PermissionUpdate, SDKMessage, SDKSessionInfo, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeBlock, ClaudeQuery, ClaudeSdkSubset, ClaudeSessionMessage } from '../types/claude.js';

/** What the CLI stores when a turn is interrupted: a user message in the transcript, not a prompt. */
export const INTERRUPTED = '[Request interrupted by user]';

/** One scripted turn of the fake CLI: what the next prompt is answered with. */
export type FakeReply =
  | { text: string }
  /** Asks `canUseTool` for `tool`; on allow the result is `output` (or the answers, for a question), then `then` is said. */
  | { tool: string; input: Record<string, unknown>; suggestions?: PermissionUpdate[]; output?: string; then?: string }
  /** Keeps the turn running until `interrupt()`. */
  | { hang: true }
  /** Ends the turn with the CLI's error result. */
  | { fail: string };

export interface FakeQueryRecord {
  options: Options | undefined;
  closed: boolean;
  model?: string | undefined;
  mode?: PermissionMode;
}

/**
 * The part of the SDK the service uses, with the CLI's process and store faked: replies are
 * scripted per prompt, sessions live in a map in the shapes `getSessionMessages` returns, and
 * `canUseTool` is asked the way the CLI asks it.
 */
export interface FakeClaudeSdk extends ClaudeSdkSubset {
  /** Consumed in order, one per prompt; a prompt past the script is echoed. */
  replies: FakeReply[];
  /** Every `query` call, in order. */
  queries: FakeQueryRecord[];
  store: Map<string, ClaudeSessionMessage[]>;
}

export const FAKE_MODELS: ModelInfo[] = [
  { value: 'sonnet', displayName: 'Sonnet', description: 'the default' },
  { value: 'opus', displayName: 'Opus', description: 'the big one' },
];

export const FAKE_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' },
  { name: 'review', description: 'Review a pull request', argumentHint: '' },
];

export function fakeClaudeSdk(): FakeClaudeSdk {
  const store = new Map<string, ClaudeSessionMessage[]>();
  const created = new Map<string, number>();
  const sdk: FakeClaudeSdk = {
    replies: [],
    queries: [],
    store,
    query: ({ prompt, options }) => fakeQuery(sdk, prompt, options),
    listSessions: async () => [...store.entries()].map(([sessionId, messages]): SDKSessionInfo => {
      const firstPrompt = firstPromptOf(messages);
      return {
        sessionId,
        summary: '',
        ...(firstPrompt !== undefined ? { firstPrompt } : {}),
        lastModified: Date.parse(messages.at(-1)?.timestamp ?? '') || Date.now(),
        createdAt: created.get(sessionId) ?? Date.now(),
      };
    }),
    getSessionMessages: async (sessionId) => {
      const messages = store.get(sessionId);
      if (messages === undefined) throw new Error(`session ${sessionId} not found`);
      return messages;
    },
    deleteSession: async (sessionId) => { store.delete(sessionId); },
  };
  function fakeQuery(owner: FakeClaudeSdk, prompt: AsyncIterable<SDKUserMessage>, options: Options | undefined): ClaudeQuery {
    const record: FakeQueryRecord = { options, closed: false, model: options?.model, ...(options?.permissionMode !== undefined ? { mode: options.permissionMode } : {}) };
    owner.queries.push(record);
    const sessionId = options?.resume ?? options?.sessionId ?? randomUUID();
    let interrupt: (() => void) | undefined;
    const interrupted = (): Promise<void> => new Promise((resolve) => { interrupt = resolve; });
    const messages = (): ClaudeSessionMessage[] => {
      let held = store.get(sessionId);
      if (held === undefined) { held = []; store.set(sessionId, held); created.set(sessionId, Date.now()); }
      return held;
    };
    const record_ = (message: Omit<ClaudeSessionMessage, 'uuid' | 'session_id' | 'timestamp'>): ClaudeSessionMessage => {
      const full: ClaudeSessionMessage = { ...message, uuid: randomUUID(), session_id: sessionId, timestamp: new Date().toISOString() };
      messages().push(full);
      return full;
    };
    const result = (fields: Record<string, unknown>): SDKMessage => ({
      type: 'result', duration_ms: 1, duration_api_ms: 1, is_error: false, num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [],
      uuid: randomUUID(), session_id: sessionId, ...fields,
    } as unknown as SDKMessage);

    async function* turn(userText: string): AsyncGenerator<SDKMessage> {
      if (userText === '/compact') {
        const all = messages();
        const tail = all.slice(-2);
        const summary = record_({ type: 'user', message: { role: 'user', content: `Summary of ${all.length} messages` }, parent_tool_use_id: null, isCompactSummary: true });
        const echo = record_({ type: 'user', message: { role: 'user', content: '<command-name>/compact</command-name><command-message>compact</command-message><command-args></command-args>' }, parent_tool_use_id: null });
        const out = record_({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' }, parent_tool_use_id: null });
        store.set(sessionId, [summary, ...tail, echo, out]);
        yield result({ subtype: 'success', result: '', user_message_uuid: echo.uuid });
        return;
      }
      const input = record_({ type: 'user', message: { role: 'user', content: userText }, parent_tool_use_id: null });
      const reply = owner.replies.shift() ?? { text: `echo: ${userText}` };
      const say = (blocks: ClaudeBlock[]): SDKMessage => {
        const stored = record_({ type: 'assistant', message: { role: 'assistant', content: blocks, usage: { input_tokens: 10, output_tokens: 5 } }, parent_tool_use_id: null });
        return { type: 'assistant', message: { role: 'assistant', content: blocks }, parent_tool_use_id: null, uuid: stored.uuid, session_id: sessionId } as unknown as SDKMessage;
      };
      if ('fail' in reply) { yield result({ subtype: 'error_during_execution', is_error: true, errors: [reply.fail], user_message_uuid: input.uuid }); return; }
      if ('hang' in reply) {
        await interrupted();
        record_({ type: 'user', message: { role: 'user', content: INTERRUPTED }, parent_tool_use_id: null });
        yield result({ subtype: 'error_during_execution', is_error: true, errors: [], terminal_reason: 'aborted_streaming', user_message_uuid: input.uuid });
        return;
      }
      if ('tool' in reply) {
        const id = `toolu_${randomUUID().slice(0, 8)}`;
        yield say([{ type: 'tool_use', id, name: reply.tool, input: reply.input }]);
        // The CLI falls back to its own rules on null; the fake allows.
        const asked = options?.canUseTool !== undefined
          ? await options.canUseTool(reply.tool, reply.input, { signal: new AbortController().signal, suggestions: reply.suggestions ?? [], toolUseID: id, requestId: `req_${id}` })
          : null;
        const decision: PermissionResult = asked ?? { behavior: 'allow', updatedInput: reply.input };
        if (decision.behavior === 'deny') {
          record_({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: decision.message, is_error: true }] }, parent_tool_use_id: null });
          yield say([{ type: 'text', text: `Understood: ${decision.message}` }]);
        } else {
          const output = reply.output ?? JSON.stringify(decision.updatedInput?.['answers'] ?? decision.updatedInput ?? {});
          record_({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] }, parent_tool_use_id: null });
          if (reply.then !== undefined) yield say([{ type: 'text', text: reply.then }]);
        }
        yield result({ subtype: 'success', result: reply.then ?? '', user_message_uuid: input.uuid });
        return;
      }
      yield say([{ type: 'text', text: reply.text }]);
      yield result({ subtype: 'success', result: reply.text, user_message_uuid: input.uuid });
    }

    async function* run(): AsyncGenerator<SDKMessage> {
      if (options?.resume !== undefined && !store.has(options.resume)) throw new Error(`No conversation found with session ID: ${options.resume}`);
      for await (const message of prompt) {
        if (record.closed) return;
        const text = typeof message.message.content === 'string' ? message.message.content : '';
        yield* turn(text);
      }
    }
    const iterator = run();
    return {
      [Symbol.asyncIterator]: () => iterator,
      interrupt: async () => { interrupt?.(); interrupt = undefined; },
      setModel: async (model) => { record.model = model; },
      setPermissionMode: async (mode) => { record.mode = mode; },
      supportedModels: async () => FAKE_MODELS,
      supportedCommands: async () => FAKE_COMMANDS,
      close: () => { record.closed = true; interrupt?.(); void iterator.return(undefined); },
    };
  }
  return sdk;
}

function firstPromptOf(messages: ClaudeSessionMessage[]): string | undefined {
  const first = messages.find((message) => message.type === 'user' && typeof message.message.content === 'string' && message.isCompactSummary !== true);
  return first !== undefined && typeof first.message.content === 'string' ? first.message.content : undefined;
}
