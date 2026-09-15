// The model asks two structured questions; the host answers from stdin and submits them on the resumed handle.
import { createInterface } from 'node:readline/promises';
import { createAgent, createAskUserTool, resume, run, textOf } from '@facio/agents';
import type { AskAnswers, AskQuestion } from '@facio/agents';
import { createFakeModel, createMemoryStore } from '@facio/agents/testing';

const questions: AskQuestion[] = [
  { id: 'lang', question: 'Which language should the project use?', header: 'Language', options: [{ label: 'TypeScript', description: 'default' }, { label: 'Rust' }], allowOther: false },
  { id: 'name', question: 'What is the project called?', header: 'Name' },
];
const model = createFakeModel({ script: [{ toolCalls: [{ name: 'ask_user', input: { questions } }] }, { text: 'Scaffolding the project now.' }] });
const store = createMemoryStore();
const agent = createAgent({ id: 'wizard', instructions: 'Ask before scaffolding.', model, tools: [createAskUserTool()], store });

const first = run({ agent, session: 'wizard-1', input: 'Set up a new project' });
const outcome = await first.outcome;
if (outcome.status !== 'awaiting' || outcome.kind !== 'input') throw new Error(`expected an input pause, got ${outcome.status}`);
const request = await store.requests.get({ sessionId: outcome.sessionId, runId: outcome.runId, requestId: outcome.requestId });
const asked = (request?.payload as { questions: AskQuestion[] }).questions;

// A terminal is prompted per question; a piped stdin answers one question per line; a missing line takes the
// first option (or a default). Piped lines are read up front because readline drops lines no question is waiting for.
const interactive = process.stdin.isTTY === true;
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
const piped: string[] = [];
if (!interactive) for await (const line of rl) piped.push(line);
const answers: AskAnswers = {};
for (const q of asked) {
  const fallback = q.options?.[0]?.label ?? 'facio-demo';
  const prompt = `${q.question}${q.options ? ` [${q.options.map((o) => o.label).join(' | ')}]` : ''} (${fallback}): `;
  const line = interactive ? await rl.question(prompt) : (piped.shift() ?? '');
  answers[q.id] = line.trim() || fallback;
  if (!interactive) console.log(`${prompt}${answers[q.id]}`);
}
rl.close();

const resumed = resume({ agent, sessionId: outcome.sessionId, runId: outcome.runId, afterSeq: 8 });
await resumed.submit({ type: 'answer', requestId: outcome.requestId, answers });
for await (const event of resumed.events) console.log(String(event.seq).padStart(2), event.type);
const final = await resumed.outcome;
console.log(final.status, final.status === 'completed' ? textOf(final.message) : final);
const steps = await store.runs.listSteps({ sessionId: outcome.sessionId, runId: outcome.runId });
const step = steps.find((s) => s.kind === 'tool');
console.log('answers on the step:', step?.kind === 'tool' ? JSON.stringify(step.original?.detail) : undefined);
