import { createAgent, createTool, run, textOf } from '@cofold/agents';
import { createFakeModel, createMemoryStore } from '@cofold/agents/testing';

const echo = createTool<{ text: string }>({
  name: 'echo',
  description: 'Return the text unchanged',
  input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  execute: (input) => input.text,
});

const model = createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'hello' } }] }, { text: 'The tool said: hello' }] });
const agent = createAgent({ id: 'demo', instructions: 'Echo what the user says, then summarize.', model, tools: [echo], store: createMemoryStore() });

const handle = run({ agent, session: 'session-1', input: 'Say hello' });
for await (const event of handle.events) console.log(String(event.seq).padStart(2), event.type);
const outcome = await handle.outcome;
console.log(outcome.status, outcome.status === 'completed' ? textOf(outcome.message) : outcome);
