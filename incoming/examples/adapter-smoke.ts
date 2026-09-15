import { createTool, newId, textOf, toolCallsOf } from '@facio/agents';
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

const reply = await model.complete({
  instructions: 'Answer briefly. Use the now tool if the user asks the time.',
  messages: [{ id: newId(), role: 'user', source: 'input', createdAt: new Date().toISOString(), parts: [{ type: 'text', text: 'What time is it?' }] }],
  tools: [now.toModelDefinition()],
  params: { temperature: 0 },
  signal: AbortSignal.timeout(60_000),
});

console.log('finish:', reply.finish, 'usage:', reply.usage);
console.log('text:', textOf(reply.message));
console.log('tool calls:', toolCallsOf(reply.message).map((c) => `${c.name}(${c.raw})`));
