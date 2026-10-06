// Pause on an approval, "die", and resume from a second store instance that shares nothing but the folder.
//
// The handle that holds a run takes the answer to its own pause (decision 122); `resume()` is for the run a
// process that is gone left behind. Process 1 runs as a child process, so nothing of its run is attached to
// this one: it prints the events up to the pause and exits.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent, createTool, resume, run, textOf } from '@cofold/agents';
import { createFakeModel } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';

const root = process.argv[2] === 'child' ? childRoot() : await mkdtemp(join(tmpdir(), 'cofold-pause-resume-'));
const sessionId = 'session-1';

/** The folder process 1 was handed: the child opens the parent's store, not one of its own. */
function childRoot(): string {
  const handed = process.argv[3];
  if (handed === undefined) throw new Error('the child needs the folder to open');
  return handed;
}

let executions = 0;
const deleteFile = createTool<{ path: string }>({
  name: 'delete_file',
  description: 'Delete a file (pretend)',
  input: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  effects: { destructive: true },
  execute: (input) => { executions += 1; return `deleted ${input.path}`; },
});
// One scripted step per process: a fake model keeps its script in memory, so the process that opens the folder
// later is given the reply the transcript is waiting for rather than the call that was already answered.
const asksToDelete = () => createFakeModel({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'notes.txt' } }] }] });
const confirms = () => createFakeModel({ script: [{ text: 'notes.txt is gone.' }] });
const options = { id: 'demo', instructions: 'Do what the user asks with the tools you have.', tools: [deleteFile] };

if (process.argv[2] === 'child') {
  // Process 1. delete_file is destructive (policy floor: approval required), so the run pauses. The pause is
  // mid-stream now (decision 122): this process reads to the `run.finished` that carries `awaiting`, the last
  // thing the pause writes, and leaves the folder holding the run.
  const paused = run({ agent: createAgent({ ...options, model: asksToDelete(), store: createFileStore({ root }) }), session: sessionId, workspace: process.cwd(), input: 'Delete notes.txt' });
  for await (const event of paused.events) {
    console.log(String(event.seq).padStart(2), event.type);
    if (event.type === 'run.finished') break;
  }
  console.log('--- process 1 exits; process 2 opens the same folder ---');
} else {
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), 'child', root], { stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  if (code !== 0) throw new Error(`process 1 exited with ${code}`);

  // Process 2: a new store instance on the same root; the request is what the pause left in the folder.
  const store = createFileStore({ root });
  const [record] = await store.runs.list({ sessionId });
  if (record?.status !== 'awaiting' || record.pendingRequestId === undefined) throw new Error('process 1 left no run waiting on a decision');
  const request = await store.requests.get({ sessionId, runId: record.runId, requestId: record.pendingRequestId });
  if (request === undefined) throw new Error(`no request ${record.pendingRequestId}`);
  console.log(`paused: ${request.kind} request ${request.requestId}`);

  // resume replays the log, then the host approves on the handle that replayed it.
  const resumed = resume({ agent: createAgent({ ...options, model: confirms(), store }), sessionId, runId: record.runId });
  const printing = (async () => {
    for await (const event of resumed.events) console.log(String(event.seq).padStart(2), event.type, event.seq <= 7 ? '(replayed)' : '');
  })();
  await resumed.submit({ type: 'approve', requestId: request.requestId });
  await printing;
  const final = await resumed.outcome;
  console.log(final.status, final.status === 'completed' ? textOf(final.message) : final);

  const steps = await store.runs.listSteps({ sessionId, runId: record.runId });
  console.log(`tool steps: ${steps.filter((s) => s.kind === 'tool').length} (executions: ${executions})`);
  await rm(root, { recursive: true, force: true });
}
