import type { ModelInfo, ModelParams, ModelProvider, Store, Tool } from '@cofold/agents';
import { createMemoryStore, createTool } from '@cofold/agents';
import { createFakeModel } from '@cofold/agents/testing';
import type { FakeStep } from '@cofold/agents/testing';
import { createChat } from './chat.js';
import { DEFAULT_INSTRUCTIONS } from './config.js';
import type { Chat } from './types/chat.js';
import type { PapoConfig } from './types/config.js';

/**
 * A provider whose one model follows a script: what the tests talk to.
 *
 * One model instance for the provider's life, so the script is consumed across turns and across a
 * resume the way a real model's replies follow the conversation; a rebuilt agent asking a fresh
 * script would be asked the same question twice.
 */
export interface FakeProvider extends ModelProvider {
  /** Every `model()` call: which id and params each turn asked for. */
  readonly asked: { id: string; params?: ModelParams }[];
}

export function fakeProvider(script: FakeStep[], modelId = 'scripted', streaming: { stream?: boolean; afterDelta?: () => Promise<void> } = {}): FakeProvider {
  const stream = streaming.stream === true;
  const info: ModelInfo = { id: modelId, name: modelId, features: { tools: true, streaming: stream, images: false, structuredOutput: false, reasoning: false } };
  const model = createFakeModel({ script: structuredClone(script), modelId, stream });
  // A pause after each delta the harness has consumed: what lets a test look at the draft while the step is still being written.
  const { afterDelta } = streaming;
  if (afterDelta !== undefined && model.stream !== undefined) {
    const inner = model.stream.bind(model);
    model.stream = async function* (request) {
      for await (const event of inner(request)) {
        yield event;
        if (event.type === 'text.delta' || event.type === 'reasoning.delta') await afterDelta();
      }
    };
  }
  const asked: { id: string; params?: ModelParams }[] = [];
  return {
    id: 'fake',
    asked,
    listModels: async () => [info, { ...info, id: 'other', name: 'The other one' }],
    model: (args) => { asked.push({ id: args.id, ...(args.params !== undefined ? { params: args.params } : {}) }); return model; },
  };
}

/** A destructive tool that counts its executions; what a confirmation is about. Its subject for a rule's match is the path. */
export function deleteFileTool(): { tool: Tool<{ path: string }>; executions: () => number } {
  let executions = 0;
  const tool = createTool<{ path: string }>({
    name: 'delete_file',
    description: 'Delete a file (pretend)',
    input: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    effects: { destructive: true },
    subject: (input) => input.path,
    execute: (input) => { executions += 1; return `deleted ${input.path}`; },
  });
  return { tool, executions: () => executions };
}

/**
 * A tool that holds the turn open until the test lets it go: what a steer or a queue is submitted
 * against. Runs without asking; a cancelled run lets it go with the reason.
 */
export function gateTool(): { tool: Tool<Record<string, never>>; release: (output?: string) => void; entered: () => Promise<void> } {
  let release: ((output: string) => void) | undefined;
  const waiters: (() => void)[] = [];
  let unseen = 0;
  const tool = createTool<Record<string, never>>({
    name: 'wait_for',
    description: 'Wait until told (pretend)',
    input: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, ctx) => new Promise<string>((resolve, reject) => {
      release = resolve;
      ctx.signal.addEventListener('abort', () => reject(new Error('the gate was cancelled')), { once: true });
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter();
      else unseen += 1;
    }),
  });
  return {
    tool,
    release: (output = 'the gate opened') => release?.(output),
    /** Resolves when the tool is next entered (at once when it already was and nobody asked). */
    entered: () => {
      if (unseen > 0) { unseen -= 1; return Promise.resolve(); }
      return new Promise<void>((resolve) => { waiters.push(resolve); });
    },
  };
}

/** `model: undefined` in the overrides means no model configured, which the type of the field cannot say. */
export function testConfig(overrides: Partial<PapoConfig> | { model: undefined } = {}): PapoConfig {
  const config: PapoConfig = {
    backend: 'cofold',
    providers: [{ id: 'fake', baseUrl: 'http://fake.invalid/v1' }],
    model: 'fake/scripted',
    permissions: 'default',
    reasoning: 'off',
    instructions: DEFAULT_INSTRUCTIONS,
    tools: { files: false, shell: false, web: false, memory: false },
    context: { maxTokens: 32_000, autoCompact: false },
    theme: 'paper',
    shell: 'workbench',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete config[key as keyof PapoConfig];
    else Object.assign(config, { [key]: value });
  }
  return config;
}

/** A chat over the memory store and a scripted model. */
export function testChat(args: {
  script: FakeStep[];
  store?: Store;
  tools?: Tool<any, any>[];
  config?: Parameters<typeof testConfig>[0];
  workspace?: string;
  home?: string;
  /** The model streams (`createFakeModel({ stream: true })`); `afterDelta` is awaited after each delta the harness took. */
  stream?: boolean;
  afterDelta?: () => Promise<void>;
  /** Providers after the fake one, in the order `config.providers` names them after `fake`. */
  providers?: ModelProvider[];
  /** Where the service's warnings go; dropped by default. */
  warn?: (message: string) => void;
}): { chat: Chat; store: Store; provider: FakeProvider } {
  const store = args.store ?? createMemoryStore();
  const provider = fakeProvider(args.script, 'scripted', {
    ...(args.stream !== undefined ? { stream: args.stream } : {}),
    ...(args.afterDelta !== undefined ? { afterDelta: args.afterDelta } : {}),
  });
  const chat = createChat({
    store,
    config: testConfig(args.config),
    providers: [provider, ...(args.providers ?? [])],
    workspace: args.workspace ?? '/work',
    home: args.home ?? '/nowhere',
    ...(args.tools !== undefined ? { tools: args.tools } : {}),
    warn: args.warn ?? (() => {}),
  });
  return { chat, store, provider };
}
