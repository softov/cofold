import type { AskAnswers } from './ask.js';
import type { RunCommand } from './command.js';
import type { RunEvent } from './event.js';
import type { Agent, AgentOptions } from './agent.js';
import type { Capability } from './capability.js';
import type { MessageSource } from './message.js';
import type { PromptCommand, SlashCommand, SlashCommandContext, SlashCommandInfo } from './slash-command.js';
import type {
  AfterToolArgs,
  AfterToolResult,
  BeforeToolArgs,
  BeforeToolResult,
  Hooks,
  RunInfo,
} from './hooks.js';
import type { Policy, PolicyDecision } from './agent.js';
import type { ContentPart } from './message.js';
import type { EffortLevel, ModelAdapter, ModelPricing, ModelRequest, ModelStreamEvent, ReasoningEffort, Usage } from './model.js';
import type { RunOutcome, RunTally, StopReason } from './outcome.js';
import type { ModelProvider } from './provider.js';
import type { Denial, KvScope, RunRecord, Store } from './store.js';
import type { Tool } from './tool.js';
import type { PermissionMode } from './policy.js';
import { describe, expectTypeOf, it } from 'vitest';
import { PERMISSION_MODE_DESCRIPTIONS, PERMISSION_MODES } from '../policy/modes.js';
import { EFFORT_LEVELS, effortOf } from '../model/effort.js';

describe('contracts', () => {
  it('RunOutcome has exactly the five terminal statuses', () => {
    expectTypeOf<RunOutcome['status']>().toEqualTypeOf<'completed' | 'awaiting' | 'stopped' | 'cancelled' | 'failed'>();
  });

  it('ContentPart has exactly the five part kinds', () => {
    expectTypeOf<ContentPart['type']>().toEqualTypeOf<'text' | 'image' | 'reasoning' | 'toolCall' | 'toolResult'>();
  });

  it('ModelProvider.model returns a ModelAdapter', () => {
    expectTypeOf<ModelProvider['model']>().returns.toEqualTypeOf<ModelAdapter>();
  });

  it('RunInfo exposes kv scopes to every hook', () => {
    expectTypeOf<RunInfo['kv']>().toEqualTypeOf<{ agent: KvScope; shared: KvScope; workspace?: KvScope }>();
  });

  it('approve accepts an optional edited input', () => {
    expectTypeOf<Extract<RunCommand, { type: 'approve' }>>().toHaveProperty('input');
  });

  it('answer carries structured answers (decision 69)', () => {
    expectTypeOf<Extract<RunCommand, { type: 'answer' }>['answers']>().toEqualTypeOf<AskAnswers>();
  });

  it('Store.runs.list returns run records and RunRecord carries usage (decisions 71, 73)', () => {
    expectTypeOf<Store['runs']['list']>().returns.toEqualTypeOf<Promise<RunRecord[]>>();
    expectTypeOf<RunRecord['usage']>().toEqualTypeOf<Usage>();
  });

  it('RunEvent carries a numeric seq', () => {
    expectTypeOf<RunEvent>().toHaveProperty('seq').toEqualTypeOf<number>();
  });

  it('Store.runs.appendEvent accepts a RunEvent', () => {
    expectTypeOf<Store['runs']['appendEvent']>().parameter(0).toEqualTypeOf<RunEvent>();
  });

  it('Hooks.beforeTool accepts a BeforeToolArgs handler and rejects an AfterToolArgs one', () => {
    const good = (args: BeforeToolArgs): BeforeToolResult =>
      args.tool.effects.destructive ? { decision: 'approval' } : { decision: 'allow' };
    const wrong = (args: AfterToolArgs): AfterToolResult => ({ output: args.output });
    expectTypeOf(good).toMatchTypeOf<Hooks['beforeTool']>();
    expectTypeOf(wrong).not.toMatchTypeOf<Hooks['beforeTool']>();
  });

  it('a typed Tool is assignable to the tool a hook receives (decision 67)', () => {
    expectTypeOf<Tool<{ text: string }>>().toMatchTypeOf<BeforeToolArgs['tool']>();
  });

  it('a beforeTool stop needs a reason (decision 97)', () => {
    expectTypeOf<{ decision: 'stop'; reason: string }>().toMatchTypeOf<BeforeToolResult>();
    expectTypeOf<{ decision: 'stop' }>().not.toMatchTypeOf<BeforeToolResult>();
    expectTypeOf<AfterToolResult['stop']>().toEqualTypeOf<{ reason: string } | undefined>();
  });

  it('ModelRequest needs a cacheKey (decision 100)', () => {
    expectTypeOf<ModelRequest['cacheKey']>().toEqualTypeOf<string>();
    expectTypeOf<Omit<ModelRequest, 'cacheKey'>>().not.toMatchTypeOf<ModelRequest>();
  });

  it('Policy has exactly decide, answering the three behaviors (cli/03 F3, decision 119)', () => {
    expectTypeOf<keyof Policy>().toEqualTypeOf<'decide'>();
    expectTypeOf<PolicyDecision['behavior']>().toEqualTypeOf<'allow' | 'ask' | 'deny'>();
    expectTypeOf<Policy['decide']>().returns.toEqualTypeOf<PolicyDecision | Promise<PolicyDecision>>();
  });

  it('steer needs a text (decision 95) and stopped may say hook (decision 97)', () => {
    expectTypeOf<Extract<RunCommand, { type: 'steer' }>['text']>().toEqualTypeOf<string>();
    expectTypeOf<{ type: 'steer' }>().not.toMatchTypeOf<RunCommand>();
    expectTypeOf<'hook'>().toMatchTypeOf<StopReason>();
  });

  it('ModelStreamEvent has exactly text.delta, reasoning.delta, toolCall.delta and done (decision 105)', () => {
    expectTypeOf<ModelStreamEvent['type']>().toEqualTypeOf<'text.delta' | 'reasoning.delta' | 'toolCall.delta' | 'done'>();
    expectTypeOf<Extract<RunEvent, { type: 'model.delta' }>['kind']>().toEqualTypeOf<'text' | 'reasoning'>();
    expectTypeOf<NonNullable<ModelAdapter['stream']>>().returns.toEqualTypeOf<AsyncIterable<ModelStreamEvent>>();
  });

  it('every outcome carries the tally, cost optional; the record and the adapter agree (decisions 108, 109)', () => {
    expectTypeOf<RunOutcome>().toMatchTypeOf<RunTally>();
    expectTypeOf<RunTally['cost']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RunRecord['cost']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ModelAdapter['pricing']>().toEqualTypeOf<ModelPricing | undefined>();
    expectTypeOf<Usage['cacheWriteTokens']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<'max_cost'>().toMatchTypeOf<StopReason>();
  });

  it('every denial names who refused, and the record and the tally carry the same list (cli/03 F3)', () => {
    expectTypeOf<Denial['by']>().toEqualTypeOf<'policy' | 'hook' | 'user' | 'invalid' | 'limit'>();
    expectTypeOf<RunRecord['denials']>().toEqualTypeOf<Denial[]>();
    expectTypeOf<RunTally['denials']>().toEqualTypeOf<Denial[] | undefined>();
  });

  it('PERMISSION_MODES lists every PermissionMode, so a new one is added to the list too', () => {
    expectTypeOf<Exclude<PermissionMode, (typeof PERMISSION_MODES)[number]>>().toBeNever();
    expectTypeOf<PermissionMode>().toEqualTypeOf<(typeof PERMISSION_MODES)[number]>();
  });

  it('every permission mode has a description (agent/06 task 01)', () => {
    expectTypeOf(PERMISSION_MODE_DESCRIPTIONS).toEqualTypeOf<Readonly<Record<PermissionMode, string>>>();
  });

  it('EFFORT_LEVELS lists every EffortLevel, so a new one is added to the list too (agent/06 task 02)', () => {
    expectTypeOf<Exclude<EffortLevel, (typeof EFFORT_LEVELS)[number]>>().toBeNever();
    expectTypeOf<EffortLevel>().toEqualTypeOf<(typeof EFFORT_LEVELS)[number]>();
    // A level is narrower than what a provider accepts; `effortOf` hands back a provider value.
    expectTypeOf<Parameters<typeof effortOf>[0]>().toEqualTypeOf<unknown>();
    expectTypeOf<ReturnType<typeof effortOf>>().toEqualTypeOf<ReasoningEffort | undefined>();
  });

  it('a SlashCommand runs with the run\'s reach and returns the notice text or nothing (AGENT-03)', () => {
    const status: SlashCommand = { name: 'status', description: 'Show the session', run: async (ctx) => `${ctx.sessionId} ${ctx.args}` };
    expectTypeOf(status).toMatchTypeOf<SlashCommand>();
    expectTypeOf<SlashCommand['run']>().returns.toEqualTypeOf<Promise<string | undefined>>();
    expectTypeOf<SlashCommandContext['args']>().toEqualTypeOf<string>();
    expectTypeOf<SlashCommandContext['kv']>().toEqualTypeOf<{ agent: KvScope; shared: KvScope; workspace?: KvScope }>();
    expectTypeOf<SlashCommandContext['store']>().toEqualTypeOf<Store>();
    expectTypeOf<{ name: 'x'; description: 'y' }>().not.toMatchTypeOf<SlashCommand>();
  });

  it('a PromptCommand expands its arguments into text, and a list entry says which kind it is (AGENT-03)', () => {
    const review: PromptCommand = { name: 'review', description: 'Review a PR', argumentHint: '<pr>', expand: async (args) => `review ${args}` };
    expectTypeOf(review).toMatchTypeOf<PromptCommand>();
    expectTypeOf<PromptCommand['expand']>().returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf<SlashCommandInfo['kind']>().toEqualTypeOf<'runtime' | 'prompt'>();
  });

  it('commands come from the options and the capabilities, and the agent holds the list (AGENT-03)', () => {
    expectTypeOf<AgentOptions['slashCommands']>().toEqualTypeOf<SlashCommand[] | undefined>();
    expectTypeOf<Agent['slashCommands']>().toEqualTypeOf<readonly SlashCommand[]>();
    expectTypeOf<Capability['slashCommands']>().toEqualTypeOf<readonly SlashCommand[] | undefined>();
    expectTypeOf<NonNullable<Capability['prompts']>>().returns.toEqualTypeOf<Promise<PromptCommand[]>>();
  });

  it('command, notice and skill are message sources, and a command run has its two events (AGENT-03)', () => {
    expectTypeOf<'command' | 'notice' | 'skill'>().toMatchTypeOf<MessageSource>();
    expectTypeOf<Extract<RunEvent, { type: 'command.started' }>>().toMatchTypeOf<{ name: string; args: string }>();
    expectTypeOf<Extract<RunEvent, { type: 'command.finished' }>['output']>().toEqualTypeOf<string | undefined>();
  });
});
