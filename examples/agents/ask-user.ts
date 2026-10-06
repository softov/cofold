// The model asks two structured questions; the host reads the request off `input.requested`, answers from
// stdin and submits the answers on the very handle the run is waiting on (decision 122).
import { createInterface } from 'node:readline/promises';
import { createAgent, createAskUserTool, run, textOf } from '@cofold/agents';
import type { AskAnswers, AskQuestion } from '@cofold/agents';
import { createFakeModel, createMemoryStore } from '@cofold/agents/testing';

const questions: AskQuestion[] = [
  { id: 'lang', question: 'Which language should the project use?', header: 'Language', options: [{ label: 'TypeScript', description: 'default' }, { label: 'Rust' }], allowOther: false },
  { id: 'name', question: 'What is the project called?', header: 'Name' },
];
const model = createFakeModel({ script: [{ toolCalls: [{ name: 'ask_user', input: { questions } }] }, { text: 'Scaffolding the project now.' }] });
const store = createMemoryStore();
const agent = createAgent({ id: 'wizard', instructions: 'Ask before scaffolding.', model, tools: [createAskUserTool()], store });

const first = run({ agent, session: 'wizard-1', input: 'Set up a new project' });

// The pause is mid-stream: the request arrives on `input.requested` and the run keeps its handle open, so
// `outcome` is the end of the turn rather than the pause (decision 122).
let asked: { requestId: string; questions: AskQuestion[] } | undefined;
let reached!: () => void;
const paused = new Promise<void>((resolve) => { reached = resolve; });
const printing = (async () => {
  for await (const event of first.events) {
    console.log(String(event.seq).padStart(2), event.type);
    if (event.type === 'input.requested') asked = { requestId: event.requestId, questions: event.questions };
    if (event.type === 'run.paused') reached();
  }
})();
await paused;
if (asked === undefined) throw new Error('the run did not pause on a question');

// A terminal is prompted per question; a piped stdin answers one question per line; a missing line takes the
// first option (or a default). Piped lines are read up front because readline drops lines no question is waiting for.
const interactive = process.stdin.isTTY === true;
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
const piped: string[] = [];
if (!interactive) for await (const line of rl) piped.push(line);
const answers: AskAnswers = {};
for (const q of asked.questions) {
  const fallback = q.options?.[0]?.label ?? 'cofold-demo';
  const prompt = `${q.question}${q.options ? ` [${q.options.map((o) => o.label).join(' | ')}]` : ''} (${fallback}): `;
  const line = interactive ? await rl.question(prompt) : (piped.shift() ?? '');
  answers[q.id] = line.trim() || fallback;
  if (!interactive) console.log(`${prompt}${answers[q.id]}`);
}
rl.close();

await first.submit({ type: 'answer', requestId: asked.requestId, answers });
await printing;
const final = await first.outcome;
console.log(final.status, final.status === 'completed' ? textOf(final.message) : final);
const steps = await store.runs.listSteps({ sessionId: first.sessionId, runId: first.runId });
const step = steps.find((s) => s.kind === 'tool');
console.log('answers on the step:', step?.kind === 'tool' ? JSON.stringify(step.original?.detail) : undefined);
