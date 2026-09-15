import type { ModelInfo, ModelProvider, Store, Tool } from '@facio/agents';
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
export function fakeProvider(script: FakeStep[], modelId = 'scripted'): ModelProvider {
  const info: ModelInfo = { id: modelId, name: modelId, features: { tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false } };
  const model = createFakeModel({ script: structuredClone(script), modelId });
  return {
    id: 'fake',
    listModels: async () => [info],
    model: () => model,
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

export function testConfig(overrides: Partial<PapoConfig> = {}): PapoConfig {
  return {
    providers: [{ id: 'fake', baseUrl: 'http://fake.invalid/v1' }],
    model: 'fake/scripted',
    permissions: 'destructive',
    instructions: DEFAULT_INSTRUCTIONS,
    theme: 'paper',
    shell: 'workbench',
    ...overrides,
  };
}

/** A chat over the memory store and a scripted model. */
export function testChat(args: { script: FakeStep[]; store?: Store; tools?: Tool<any, any>[]; config?: Partial<PapoConfig>; workspace?: string }): { chat: Chat; store: Store } {
  const store = args.store ?? createMemoryStore();
  const chat = createChat({
    store,
    config: testConfig(args.config),
    providers: [fakeProvider(args.script)],
    workspace: args.workspace ?? '/work',
    home: '/nowhere',
    ...(args.tools !== undefined ? { tools: args.tools } : {}),
    warn: () => {},
  });
  return { chat, store };
}
