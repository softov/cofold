import type { RunAbort } from '../types/abort.js';
import type { Agent } from '../types/agent.js';
import type { ContentPart, Message } from '../types/message.js';
import type { RunOutcome } from '../types/outcome.js';
import type { RunArgs, RunHandle } from '../types/run.js';
import type { SlashCommand } from '../types/slash-command.js';
import type { SessionRecord } from '../types/store.js';
import type { InternalRunHandle, SteerQueue, TurnContext } from '../types/turn.js';
import { AgentError } from '../errors.js';
import { newId } from '../ids.js';
import { ZERO_USAGE } from '../model/usage.js';
import { createRunAbort } from './abort.js';
import { detachRun } from './answer.js';
import { createEmitter } from './events.js';
import { createRunHandle } from './handle.js';
import { enqueueSteer, rejectSteering } from './steering.js';
import { COMPACT_COMMAND, parseSlash, promptCommandsOf } from './slash.js';
import {
  abortOutcome,
  createTurnContext,
  fail,
  finishRun,
  resolveCapabilities,
  runTurn,
  settle,
  summarize,
  tally,
} from './turn.js';

/** Writer lease refresh period while a run is `running` (decision 68). */
export const HEARTBEAT_MS = 10_000;

/**
 * One turn. Returns synchronously; the loop runs in the background and settles `handle.outcome`. An input that names
 * a runtime command runs that command instead of a model turn (AGENT-03).
 */
export function run<Resources = Record<string, unknown>>(args: RunArgs<Resources>): RunHandle {
  const runId = newId();
  const abort = createRunAbort({ ...(args.signal ? { external: args.signal } : {}), timeoutMs: args.agent.limits.timeoutMs });
  const steering: SteerQueue = [];
  // The context exists only once setup has run; a command that arrives before that finds no acceptor.
  let ctx: TurnContext | undefined;
  const handle = createRunHandle({
    runId, sessionId: args.session, agentId: args.agent.definition.id, abort,
    steer: (text, parts) => enqueueSteer(steering, text, parts),
    // The run answers its own pause (decision 122): the acceptor is installed by the loop's pause.
    onCommand: async (command) => {
      const accept = ctx?.accept;
      if (!accept) throw new AgentError({ code: 'not_found', message: `run ${runId} has no open request` });
      await accept(command);
    },
    // Before the context exists there is no pause to leave; the run is over or never started.
    detach: () => { if (ctx !== undefined) void detachRun(ctx); },
  });
  void (async () => {
    const setup = await setupRun(args, runId, abort, handle, steering);
    if (!setup) return;
    ctx = setup.ctx;
    ctx.heartbeat = startHeartbeat(ctx.store, ctx.sessionId, runId);
    // `/compact` is a command run whose one step is the summary; the loop's compact branch takes it.
    if (setup.command && !ctx.compact) await runCommand(ctx, setup.input, setup.command.command, setup.command.args);
    else await runTurn(ctx, { kind: 'model' });
  })();
  return handle;
}

/** A failed beat is not the loop's problem: the store refuses it once the claim is gone, and the next beat retries. */
export function startHeartbeat(store: Agent['store'], sessionId: string, runId: string): ReturnType<typeof setInterval> {
  return setInterval(() => { void store.sessions.heartbeat({ sessionId, runId }).catch(() => {}); }, HEARTBEAT_MS);
}

/**
 * Steps 1-5 of a turn: session and run record (decision 53), writer claim (decision 47), capabilities,
 * input message, `run.started`. An input that names a runtime command is written as a `command` message and
 * followed by `command.started`, and the command comes back with the context; one that names a prompt command
 * gets a `skill` message after it (AGENT-03). Returns undefined after finishing the handle on any failure.
 */
async function setupRun<Resources>(args: RunArgs<Resources>, runId: string, abort: RunAbort, handle: InternalRunHandle, steering: SteerQueue): Promise<{ ctx: TurnContext; input: Message; command?: { command: SlashCommand; args: string } } | undefined> {
  const { agent } = args;
  const { store } = agent;
  const sessionId = args.session;
  const agentId = agent.definition.id;
  const now = () => new Date().toISOString();
  let ctx: TurnContext | undefined;
  try {
    let session = await store.sessions.get({ sessionId });
    if (!session) {
      try {
        session = await store.sessions.create({ sessionId, agentId, ...(args.workspace !== undefined ? { workspace: args.workspace } : {}) });
      } catch (e) {
        if ((e as AgentError).code !== 'already_exists') throw e;
        session = (await store.sessions.get({ sessionId })) as SessionRecord;
      }
    }
    const parts: ContentPart[] = typeof args.input === 'string' ? [{ type: 'text', text: args.input }] : args.input;
    // A caller-supplied id must be new in the session (cli/03 F2); a duplicate fails on the handle alone, nothing written (decision 92's shape).
    if (args.messageId !== undefined && (await store.sessions.listMessages({ sessionId })).some((message) => message.id === args.messageId)) {
      throw new AgentError({ code: 'already_exists', message: `message ${args.messageId} already exists in session ${sessionId}` });
    }
    const slash = parseSlash(args.input);
    const found = slash && agent.slashCommands.find((command) => command.name === slash.name);
    const command = found && slash ? { command: found, args: slash.args } : undefined;
    const input: Message = { id: args.messageId ?? newId(), role: 'user', source: command ? 'command' : 'input', parts, createdAt: now() };
    await store.runs.create({ runId, sessionId, agentId, status: 'running', createdAt: now(), updatedAt: now(), usage: ZERO_USAGE, steps: 0, denials: [], inputMessageId: input.id, ...(args.model === undefined ? {} : { model: args.model }) });
    const emitter = createEmitter({ store, runId, sessionId, agentId, publish: handle.publish, onEvent: agent.hooks.onEvent?.bind(agent.hooks), warn: agent.warn });
    ctx = createTurnContext({ agent, store, session, runId, abort, emit: emitter.emit, handle, steering, counters: { usage: ZERO_USAGE, steps: 0, cost: agent.model.pricing ? 0 : undefined, denials: [], stepIndex: 0, toolCalls: 0 }, claimed: false, compact: command?.command === COMPACT_COMMAND, inputMessageId: input.id });

    ctx.claimed = await store.sessions.claimWriter({ sessionId, runId });
    if (!ctx.claimed) { await finishRun(ctx, fail(ctx, 'writer_busy', `session ${sessionId} is being written by another run`)); return undefined; }
    if (!(await resolveCapabilities(ctx))) return undefined;

    const skill = slash && !command ? await expandPrompt(ctx, slash) : undefined;
    if (skill) ctx.skillMessageId = skill.id;
    await store.sessions.appendMessages({ sessionId, runId, messages: skill ? [input, skill] : [input] });
    await ctx.emit({ type: 'run.started', input });
    if (!command) return { ctx, input };
    await ctx.emit({ type: 'command.started', name: command.command.name, args: command.args });
    return { ctx, input, command };
  } catch (e) {
    const outcome: RunOutcome = { status: 'failed', error: { code: e instanceof AgentError ? e.code : 'internal', message: (e as Error).message, detail: summarize(e) }, usage: ZERO_USAGE, steps: 0, ...(agent.model.pricing ? { cost: 0 } : {}), denials: [] };
    if (ctx) {
      try { await finishRun(ctx, outcome); return undefined; }
      catch { /* fall through to the last resort */ }
    }
    if (ctx) settle(ctx, outcome);
    else { rejectSteering(steering, runId); abort.dispose(); handle.finish(outcome); }
    return undefined;
  }
}

/**
 * A runtime command run after `command.started` (AGENT-03): no model step; the text `run` returns is written as a
 * `notice` message, then `command.finished`, then the run completes. A command that throws fails the run with no notice.
 */
async function runCommand(ctx: TurnContext, input: Message, command: SlashCommand, args: string): Promise<void> {
  const { store, sessionId, runId } = ctx;
  try {
    let output: string | undefined;
    try {
      output = await command.run({
        agent: ctx.agent, sessionId, runId,
        ...(ctx.workspace !== undefined ? { workspace: ctx.workspace } : {}),
        args, store, kv: ctx.run.kv, signal: ctx.abort.signal,
      });
    } catch (e) {
      if (ctx.abort.signal.aborted) return await finishRun(ctx, abortOutcome(ctx));
      return await finishRun(ctx, fail(ctx, 'command_error', `/${command.name}: ${(e as Error).message}`, summarize(e)));
    }
    let message = input;
    if (output !== undefined) {
      message = { id: newId(), role: 'user', source: 'notice', parts: [{ type: 'text', text: output }], createdAt: new Date().toISOString() };
      await store.sessions.appendMessages({ sessionId, runId, messages: [message] });
    }
    await ctx.emit({ type: 'command.finished', name: command.name, ...(output !== undefined ? { output } : {}) });
    await finishRun(ctx, { status: 'completed', message, ...tally(ctx) });
  } catch (e) {
    // Store failures end here, as in the loop; the outcome is still delivered.
    const outcome = fail(ctx, e instanceof AgentError ? e.code : 'internal', (e as Error).message, summarize(e));
    try { await finishRun(ctx, outcome); }
    catch { settle(ctx, outcome); }
  }
}

/**
 * The `skill` message for a slash line that names a prompt command, or undefined when none does (AGENT-03). A list
 * or an expansion that throws is told to `agent.warn`, and the turn goes on without the skill.
 */
async function expandPrompt(ctx: TurnContext, slash: { name: string; args: string }): Promise<Message | undefined> {
  let text: string;
  try {
    const prompt = (await promptCommandsOf(ctx.agent, { ...(ctx.workspace !== undefined ? { workspace: ctx.workspace } : {}) })).find((command) => command.name === slash.name);
    if (!prompt) return undefined;
    text = await prompt.expand(slash.args);
  } catch (e) {
    ctx.agent.warn(`/${slash.name}: the prompt command did not expand: ${(e as Error).message}`);
    return undefined;
  }
  return { id: newId(), role: 'user', source: 'skill', parts: [{ type: 'text', text }], createdAt: new Date().toISOString() };
}
