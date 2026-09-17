import { randomUUID } from 'node:crypto';
import type { ModelInfo, Options, PermissionResult, PermissionUpdate, SDKMessage, SDKSessionInfo, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeBlock, ClaudeMessage, ClaudeQuery, ClaudeSdkSubset, ClaudeSessionMessage } from '../types/claude.js';

/** What the CLI stores when a turn is interrupted: a user message in the transcript, not a prompt. */
export const INTERRUPTED = '[Request interrupted by user]';
/** What the CLI writes as the result of the tool call an interrupt cut. */
export const INTERRUPTED_TOOL = '[Request interrupted by user for tool use]';

/** `ask` ended because `interrupt()` came while the tool ran. */
const ABORTED: unique symbol = Symbol('aborted');

/** One scripted turn of the fake CLI: what the next prompt is answered with. */
export type FakeReply =
  | { text: string }
  /** A reply of several blocks, stored as the CLI stores it: one entry per block, all sharing the reply's `message.id`. */
  | { blocks: ClaudeBlock[] }
  /**
   * Asks `canUseTool` for `tool` (with the CLI's `title` and `suppressAlwaysAllowRule` when given); on allow
   * the result is `output` (or the answers, for a question), then `then` is said.
   */
  | FakeToolReply
  /** Keeps the turn running until `interrupt()`. */
  | { hang: true }
  /** Ends the turn with the CLI's error result. */
  | { fail: string }
  /** Ends the turn as the CLI reports an API error: `subtype: 'success'` with `is_error` and the text in `result`. */
  | { apiError: string };

/**
 * The model asks for `tool`; on allow the result is `output` (or the answers, for a question). `then` is what
 * follows: a sentence, or another ask (a turn that stops twice); a denied ask is followed by `then` too when
 * it is an ask, else by one sentence acknowledging the reason.
 */
export interface FakeToolReply {
  tool: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  title?: string;
  suppressAlways?: boolean;
  output?: string;
  /** The tool runs until this resolves, with its value as the output: what a message is pushed during. */
  waitFor?: Promise<string>;
  then?: string | FakeToolReply;
}

export interface FakeQueryRecord {
  options: Options | undefined;
  closed: boolean;
  model?: string | undefined;
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
  /** What `canUseTool` answered, in order: the allow with its rules, or the deny with its reason. */
  decisions: PermissionResult[];
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
    decisions: [],
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
    const record: FakeQueryRecord = { options, closed: false, model: options?.model };
    owner.queries.push(record);
    const sessionId = options?.resume ?? options?.sessionId ?? randomUUID();
    let interrupt: (() => void) | undefined;
    const interrupted = (): Promise<void> => new Promise((resolve) => { interrupt = resolve; });
    /** An `interrupt()` the turn has not answered yet: a decision denied under it ends the turn, as the CLI's does (ahpd's cancel). */
    let interruptAsked = false;
    const messages = (): ClaudeSessionMessage[] => {
      let held = store.get(sessionId);
      if (held === undefined) { held = []; store.set(sessionId, held); created.set(sessionId, Date.now()); }
      return held;
    };
    const make = (message: Omit<ClaudeSessionMessage, 'uuid' | 'session_id' | 'timestamp'>, uuid: string = randomUUID()): ClaudeSessionMessage =>
      ({ ...message, uuid, session_id: sessionId, timestamp: new Date().toISOString() });
    /**
     * What the turn wrote so far, kept out of the store until its result: the CLI writes its
     * transcript after it answers (CLI-03 F5), so a read during the turn sees only what was streamed.
     */
    const pending: ClaudeSessionMessage[] = [];
    const record_ = (message: Omit<ClaudeSessionMessage, 'uuid' | 'session_id' | 'timestamp'>, uuid?: string): ClaudeSessionMessage => {
      const full = make(message, uuid);
      pending.push(full);
      return full;
    };
    const result = (fields: Record<string, unknown>): SDKMessage => {
      messages().push(...pending.splice(0));
      return {
        type: 'result', duration_ms: 1, duration_api_ms: 1, is_error: false, num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [],
        uuid: randomUUID(), session_id: sessionId, ...fields,
      } as unknown as SDKMessage;
    };

    // One reply, one API message id; the CLI stores and streams one entry per block, each carrying the whole usage.
    const say = (blocks: ClaudeBlock[]): SDKMessage[] => {
      const id = `msg_${randomUUID().slice(0, 8)}`;
      return blocks.map((block) => {
        const message: ClaudeMessage = { role: 'assistant', id, content: [block], usage: { input_tokens: 10, output_tokens: 5 } };
        const stored = record_({ type: 'assistant', message, parent_tool_use_id: null });
        return { type: 'assistant', message, parent_tool_use_id: null, uuid: stored.uuid, session_id: sessionId } as unknown as SDKMessage;
      });
    };

    async function* turn(userText: string, uuid: string | undefined): AsyncGenerator<SDKMessage> {
      if (userText === '/compact') {
        const all = messages();
        const tail = all.slice(-2);
        // The summary is the model's: the next scripted text is it, as the harness's fake model gives it.
        const scripted = owner.replies.shift();
        const summary = make({ type: 'user', message: { role: 'user', content: scripted !== undefined && 'text' in scripted ? scripted.text : `Summary of ${all.length} messages` }, parent_tool_use_id: null, isCompactSummary: true });
        const echo = make({ type: 'user', message: { role: 'user', content: '<command-name>/compact</command-name><command-message>compact</command-message><command-args></command-args>' }, parent_tool_use_id: null }, uuid);
        const out = make({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' }, parent_tool_use_id: null });
        store.set(sessionId, [summary, ...tail, echo, out]);
        yield result({ subtype: 'success', result: '', user_message_uuid: echo.uuid });
        return;
      }
      // The client's uuid is the record's, as the CLI keeps it; the prompt is echoed on the stream under it.
      const input = record_({ type: 'user', message: { role: 'user', content: userText }, parent_tool_use_id: null }, uuid);
      yield { type: 'user', uuid: input.uuid, message: input.message, parent_tool_use_id: null, session_id: sessionId } as unknown as SDKMessage;
      const reply = owner.replies.shift() ?? { text: `echo: ${userText}` };
      if ('fail' in reply) { yield result({ subtype: 'error_during_execution', is_error: true, errors: [reply.fail], user_message_uuid: input.uuid }); return; }
      if ('apiError' in reply) { yield result({ subtype: 'success', is_error: true, result: reply.apiError, user_message_uuid: input.uuid }); return; }
      if ('blocks' in reply) {
        yield* say(reply.blocks);
        yield result({ subtype: 'success', result: reply.blocks.filter((block): block is Extract<ClaudeBlock, { type: 'text' }> => block.type === 'text').map((block) => block.text).join('\n'), user_message_uuid: input.uuid });
        return;
      }
      if ('hang' in reply) {
        await interrupted();
        // Closed while hanging: the process is gone, and a gone process writes no result.
        if (record.closed) return;
        record_({ type: 'user', message: { role: 'user', content: INTERRUPTED }, parent_tool_use_id: null });
        yield result({ subtype: 'error_during_execution', is_error: true, errors: [], terminal_reason: 'aborted_streaming', user_message_uuid: input.uuid });
        return;
      }
      if ('tool' in reply) {
        const final = yield* ask(reply);
        if (final === ABORTED) {
          record_({ type: 'user', message: { role: 'user', content: INTERRUPTED }, parent_tool_use_id: null });
          yield result({ subtype: 'error_during_execution', is_error: true, errors: [], terminal_reason: 'aborted_tools', user_message_uuid: input.uuid });
          return;
        }
        yield result({ subtype: 'success', result: final, user_message_uuid: input.uuid });
        return;
      }
      yield* say([{ type: 'text', text: reply.text }]);
      yield result({ subtype: 'success', result: reply.text, user_message_uuid: input.uuid });
    }

    /** One ask of `canUseTool` and what follows it; returns the turn's final text, or that an interrupt cut the tool. */
    async function* ask(reply: FakeToolReply): AsyncGenerator<SDKMessage, string | typeof ABORTED> {
      const id = `toolu_${randomUUID().slice(0, 8)}`;
      yield* say([{ type: 'tool_use', id, name: reply.tool, input: reply.input }]);
      // The CLI falls back to its own rules on null; the fake allows. Under `bypassPermissions` the CLI asks nobody
      // about a tool (the question tool still reaches the person; not verified against the real CLI).
      const bypass = options?.permissionMode === 'bypassPermissions' && reply.tool !== 'AskUserQuestion';
      const asked = options?.canUseTool !== undefined && !bypass
        ? await options.canUseTool(reply.tool, reply.input, {
          signal: new AbortController().signal,
          suggestions: reply.suggestions ?? [],
          ...(reply.title !== undefined ? { title: reply.title } : {}),
          ...(reply.suppressAlways === true ? { suppressAlwaysAllowRule: true } : {}),
          toolUseID: id,
          requestId: `req_${id}`,
        })
        : null;
      const decision: PermissionResult = asked ?? { behavior: 'allow', updatedInput: reply.input };
      owner.decisions.push(decision);
      if (decision.behavior === 'deny') {
        record_({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: decision.message, is_error: true }] }, parent_tool_use_id: null });
        // Denied because the turn was stopped: the CLI writes no reply after it.
        if (interruptAsked) return ABORTED;
        if (typeof reply.then === 'object') return yield* ask(reply.then);
        const text = `Understood: ${decision.message}`;
        yield* say([{ type: 'text', text }]);
        return text;
      }
      let output: string;
      if (reply.waitFor !== undefined) {
        // The tool runs until released, or until `interrupt()` cuts it, as the CLI cuts a running tool.
        const got: string | typeof ABORTED = await Promise.race([reply.waitFor, interrupted().then((): typeof ABORTED => ABORTED)]);
        if (got === ABORTED) {
          record_({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: INTERRUPTED_TOOL, is_error: true }] }, parent_tool_use_id: null });
          return ABORTED;
        }
        output = got;
      } else {
        output = reply.output ?? JSON.stringify(decision.updatedInput?.['answers'] ?? decision.updatedInput ?? {});
      }
      record_({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] }, parent_tool_use_id: null });
      // What was pushed while the tool ran goes to the model with the result, as the CLI takes a steer (ahpd `steer`).
      for (const pushed of inbox.splice(0)) {
        const said = record_({ type: 'user', message: pushed.message as ClaudeMessage, parent_tool_use_id: null }, pushed.uuid);
        yield { type: 'user', uuid: said.uuid, message: said.message, parent_tool_use_id: null, session_id: sessionId } as unknown as SDKMessage;
      }
      if (typeof reply.then === 'object') return yield* ask(reply.then);
      if (reply.then !== undefined) yield* say([{ type: 'text', text: reply.then }]);
      return reply.then ?? '';
    }

    /** The prompt, read as it comes: a message that arrives mid-turn waits here for the turn to take it. */
    const inbox: SDKUserMessage[] = [];
    let promptDone = false;
    let wakeInbox: (() => void) | undefined;
    void (async () => {
      for await (const message of prompt) { inbox.push(message); wakeInbox?.(); wakeInbox = undefined; }
      promptDone = true;
      wakeInbox?.();
    })();
    const nextPrompt = async (): Promise<SDKUserMessage | undefined> => {
      for (;;) {
        const message = inbox.shift();
        if (message !== undefined) return message;
        if (promptDone || record.closed) return undefined;
        await new Promise<void>((resolve) => { wakeInbox = resolve; });
      }
    };

    async function* run(): AsyncGenerator<SDKMessage> {
      if (options?.resume !== undefined && !store.has(options.resume)) throw new Error(`No conversation found with session ID: ${options.resume}`);
      for (;;) {
        const message = await nextPrompt();
        if (message === undefined || record.closed) return;
        const text = typeof message.message.content === 'string' ? message.message.content : '';
        interruptAsked = false;
        yield* turn(text, message.uuid);
      }
    }
    const iterator = run();
    return {
      [Symbol.asyncIterator]: () => iterator,
      interrupt: async () => { interruptAsked = true; interrupt?.(); interrupt = undefined; },
      setModel: async (model) => { record.model = model; },
      supportedModels: async () => FAKE_MODELS,
      supportedCommands: async () => FAKE_COMMANDS,
      close: () => { record.closed = true; interrupt?.(); wakeInbox?.(); void iterator.return(undefined); },
    };
  }
  return sdk;
}

function firstPromptOf(messages: ClaudeSessionMessage[]): string | undefined {
  const first = messages.find((message) => message.type === 'user' && typeof message.message.content === 'string' && message.isCompactSummary !== true);
  return first !== undefined && typeof first.message.content === 'string' ? first.message.content : undefined;
}
