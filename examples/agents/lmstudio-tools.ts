import { createAgent, createTool, run, textOf } from '@facio/agents';
import { createMemoryStore } from '@facio/agents/testing';
import { openaiCompat } from '@facio/model-openai-compat';

const model = openaiCompat({
  baseUrl: process.env.FACIO_BASE_URL ?? 'http://localhost:1234/v1',
  model: process.env.FACIO_MODEL ?? 'qwen/qwen3-8b',
  ...(process.env.FACIO_API_KEY ? { apiKey: process.env.FACIO_API_KEY } : {}),
  features: { tools: true },
});

const now = createTool({
  name: 'now',
  description: 'Current time in ISO 8601',
  input: { type: 'object', properties: {}, additionalProperties: false },
  effects: { reads: true },
  execute: () => new Date().toISOString(),
});

const agent = createAgent({
  id: 'clock',
  instructions: 'Answer briefly. Use the now tool if the user asks the time.',
  model,
  tools: [now],
  store: createMemoryStore(),
  params: { temperature: 0 },
  limits: { timeoutMs: 60_000 },
  hooks: {
    onEvent: (event) => {
      if (event.type.startsWith('tool.')) console.log(event.type, JSON.stringify(event));
    },
  },
});

const handle = run({ agent, session: 'session-1', input: 'What time is it? Use the tool.' });
for await (const event of handle.events) console.log(String(event.seq).padStart(2), event.type);
const outcome = await handle.outcome;
console.log(outcome.status, outcome.status === 'completed' ? textOf(outcome.message) : outcome);
