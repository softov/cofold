import type { RunHandle } from '@doopx/agents';
import { createAgent, createTool, run, textOf } from '@doopx/agents';
import { createFakeModel, createMemoryStore } from '@doopx/agents/testing';

// A person types while the turn is running: the message steers the run instead of cancelling it.
// The steer is appended after the tool result and before the next model step (decisions 95-96).

const echo = createTool<{ text: string }>({
  name: 'echo',
  description: 'Return the text unchanged',
  input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  execute: (input) => input.text,
});

const model = createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'hello' } }] }, { text: 'The tool said: hello. And bye!' }] });
const agent = createAgent({ id: 'demo', instructions: 'Echo what the user says, then summarize.', model, tools: [echo], store: createMemoryStore() });

const handle: RunHandle = run({ agent, session: 'session-1', input: 'Say hello' });
let steered: Promise<void> | undefined;
for await (const event of handle.events) {
  console.log(String(event.seq).padStart(2), event.type);
  if (event.type === 'tool.started' && !steered) steered = handle.submit({ type: 'steer', text: 'Also say bye' });
}
await steered;
const outcome = await handle.outcome;
console.log(outcome.status, outcome.status === 'completed' ? textOf(outcome.message) : outcome);

const transcript = await agent.store.sessions.listMessages({ sessionId: 'session-1' });
console.log('transcript:', transcript.map((m) => `${m.role}(${m.source})`).join(' > '));

try {
  await handle.submit({ type: 'steer', text: 'too late' });
} catch (e) {
  console.log('after the run:', (e as { code?: string }).code);
}
