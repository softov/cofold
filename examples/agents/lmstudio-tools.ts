import { createAgent, createTool, run, textOf } from '@facio/agents';
import { createMemoryStore } from '@facio/agents/testing';
import { openaiCompat } from '@facio/model-openai-compat';

// USD per million tokens; when both are set the run records its cost (a real host passes the catalogue's pricing through).
const pricingIn = Number(process.env.FACIO_PRICING_IN);
const pricingOut = Number(process.env.FACIO_PRICING_OUT);
const pricing = Number.isFinite(pricingIn) && Number.isFinite(pricingOut) && process.env.FACIO_PRICING_IN && process.env.FACIO_PRICING_OUT
  ? { inputPerMillion: pricingIn, outputPerMillion: pricingOut, currency: 'USD' as const }
  : undefined;

const model = openaiCompat({
  baseUrl: process.env.FACIO_BASE_URL ?? 'http://localhost:1234/v1',
  model: process.env.FACIO_MODEL ?? 'qwen/qwen3-8b',
  ...(process.env.FACIO_API_KEY ? { apiKey: process.env.FACIO_API_KEY } : {}),
  ...(pricing ? { pricing } : {}),
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
// The answer streams: text deltas are printed as they arrive, every other event on its own line.
let streaming = false;
for await (const event of handle.events) {
  if (event.type === 'model.delta') {
    if (event.kind !== 'text') continue;
    if (!streaming) { process.stdout.write('   '); streaming = true; }
    process.stdout.write(event.text);
    continue;
  }
  if (streaming) { process.stdout.write('\n'); streaming = false; }
  console.log(String(event.seq).padStart(2), event.type);
}
const outcome = await handle.outcome;
console.log(outcome.status, outcome.status === 'completed' ? textOf(outcome.message) : outcome);
console.log('usage', JSON.stringify(outcome.usage), outcome.cost !== undefined ? `cost ${outcome.cost} USD` : 'cost unknown (set FACIO_PRICING_IN and FACIO_PRICING_OUT)');
