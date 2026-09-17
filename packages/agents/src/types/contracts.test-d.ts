import type { AskAnswers } from './ask.js';
import type { RunCommand } from './command.js';
import type { RunEvent } from './event.js';
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
import type { ModelAdapter, ModelPricing, ModelRequest, ModelStreamEvent, Usage } from './model.js';
import type { RunOutcome, RunTally, StopReason } from './outcome.js';
import type { ModelProvider } from './provider.js';
import type { Denial, KvScope, RunRecord, Store } from './store.js';
import type { Tool } from './tool.js';
import { describe, expectTypeOf, it } from 'vitest';

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
});
