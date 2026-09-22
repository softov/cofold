// Pause on an approval, "die", and resume from a second store instance that shares nothing but the folder.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, createTool, resume, run, textOf } from '@doopx/agents';
import { createFakeModel } from '@doopx/agents/testing';
import { createFileStore } from '@doopx/store-file';

const root = await mkdtemp(join(tmpdir(), 'doopx-pause-resume-'));
let executions = 0;
const deleteFile = createTool<{ path: string }>({
  name: 'delete_file',
  description: 'Delete a file (pretend)',
  input: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  effects: { destructive: true },
  execute: (input) => { executions += 1; return `deleted ${input.path}`; },
});
const model = createFakeModel({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'notes.txt' } }] }, { text: 'notes.txt is gone.' }] });
const options = { id: 'demo', instructions: 'Do what the user asks with the tools you have.', model, tools: [deleteFile] };

// Process 1: the run pauses because delete_file is destructive (policy floor: approval required).
const first = createAgent({ ...options, store: createFileStore({ root }) });
const paused = run({ agent: first, session: 'session-1', workspace: process.cwd(), input: 'Delete notes.txt' });
for await (const event of paused.events) console.log(String(event.seq).padStart(2), event.type);
const outcome = await paused.outcome;
if (outcome.status !== 'awaiting') throw new Error(`expected awaiting, got ${outcome.status}`);
console.log(`paused: ${outcome.kind} request ${outcome.requestId}`);
console.log('--- process 1 exits; process 2 opens the same folder ---');

// Process 2: a new store instance on the same root; resume replays the log, then the host approves.
const second = createAgent({ ...options, store: createFileStore({ root }) });
const resumed = resume({ agent: second, sessionId: outcome.sessionId, runId: outcome.runId });
const printing = (async () => {
  for await (const event of resumed.events) console.log(String(event.seq).padStart(2), event.type, event.seq <= 7 ? '(replayed)' : '');
})();
await resumed.submit({ type: 'approve', requestId: outcome.requestId });
await printing;
const final = await resumed.outcome;
console.log(final.status, final.status === 'completed' ? textOf(final.message) : final);

const steps = await second.store.runs.listSteps({ sessionId: outcome.sessionId, runId: outcome.runId });
console.log(`tool steps: ${steps.filter((s) => s.kind === 'tool').length} (executions: ${executions})`);
await rm(root, { recursive: true, force: true });
