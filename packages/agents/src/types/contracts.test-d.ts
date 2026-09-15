import { describe, expectTypeOf, it } from 'vitest';
import type { RunCommand } from './command.js';
import type { AfterToolArgs, AfterToolResult, BeforeToolArgs, BeforeToolResult, Hooks, RunInfo } from './hooks.js';
import type { RunEvent } from './event.js';
import type { ContentPart } from './message.js';
import type { ModelAdapter } from './model.js';
import type { ModelProvider } from './provider.js';
import type { RunOutcome } from './outcome.js';
import type { KvScope, Store } from './store.js';

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
});
