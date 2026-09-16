import type { ModelInfo, ModelParams, ModelProvider, Store, Tool } from '@facio/agents';
import { createMemoryStore, createTool } from '@facio/agents';
import { createFakeModel } from '@facio/agents/testing';
import type { FakeStep } from '@facio/agents/testing';
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

export function fakeProvider(script: FakeStep[], modelId = 'scripted'): FakeProvider {
  const info: ModelInfo = { id: modelId, name: modelId, features: { tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false } };
  const model = createFakeModel({ script: structuredClone(script), modelId });
  const asked: { id: string; params?: ModelParams }[] = [];
  return {
    id: 'fake',
    asked,
    listModels: async () => [info, { ...info, id: 'other', name: 'The other one' }],
    model: (args) => { asked.push({ id: args.id, ...(args.params !== undefined ? { params: args.params } : {}) }); return model; },
  };
}

/** A destructive tool that counts its executions; what a confirmation is about. */
export function deleteFileTool(): { tool: Tool<{ path: string }>; executions: () => number } {
  let executions = 0;
  const tool = createTool<{ path: string }>({
    name: 'delete_file',
    description: 'Delete a file (pretend)',
    input: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    effects: { destructive: true },
    execute: (input) => { executions += 1; return `deleted ${input.path}`; },
  });
  return { tool, executions: () => executions };
}

/** `model: undefined` in the overrides means no model configured, which the type of the field cannot say. */
export function testConfig(overrides: Partial<PapoConfig> | { model: undefined } = {}): PapoConfig {
  const config: PapoConfig = {
    backend: 'facio',
    providers: [{ id: 'fake', baseUrl: 'http://fake.invalid/v1' }],
    model: 'fake/scripted',
    permissions: 'destructive',
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
export function testChat(args: { script: FakeStep[]; store?: Store; tools?: Tool<any, any>[]; config?: Parameters<typeof testConfig>[0]; workspace?: string; home?: string }): { chat: Chat; store: Store; provider: FakeProvider } {
  const store = args.store ?? createMemoryStore();
  const provider = fakeProvider(args.script);
  const chat = createChat({
    store,
    config: testConfig(args.config),
    providers: [provider],
    workspace: args.workspace ?? '/work',
    home: args.home ?? '/nowhere',
    ...(args.tools !== undefined ? { tools: args.tools } : {}),
    warn: () => {},
  });
  return { chat, store, provider };
}
