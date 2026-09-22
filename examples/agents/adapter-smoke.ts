import type { ReasoningEffort } from '@doopx/agents';
import { createTool, newId, textOf, toolCallsOf } from '@doopx/agents';
import { openaiCompat } from '@doopx/model-openai-compat';

// `--effort <level>` asks for that reasoning level (decision 98) and prints the wire body the adapter sends.
const effortAt = process.argv.indexOf('--effort');
const effort = effortAt === -1 ? undefined : (process.argv[effortAt + 1] as ReasoningEffort | undefined);
const printing: typeof fetch = async (url, init) => {
  console.log('wire body:', JSON.stringify(JSON.parse(String(init?.body)), null, 2));
  return fetch(url, init);
};

const model = openaiCompat({
  baseUrl: process.env.FACIO_BASE_URL ?? 'http://localhost:1234/v1',
  model: process.env.FACIO_MODEL ?? 'qwen/qwen3-8b',
  ...(process.env.FACIO_API_KEY ? { apiKey: process.env.FACIO_API_KEY } : {}),
  features: { tools: true, reasoning: effort !== undefined },
  ...(effort !== undefined ? { params: { reasoning: { effort } }, fetch: printing } : {}),
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
  cacheKey: 'adapter-smoke',
  signal: AbortSignal.timeout(60_000),
});

console.log('finish:', reply.finish, 'usage:', reply.usage);
console.log('text:', textOf(reply.message));
console.log('tool calls:', toolCallsOf(reply.message).map((c) => `${c.name}(${c.raw})`));
