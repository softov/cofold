import { describe, expectTypeOf, it } from 'vitest';
import type { AfterToolArgs, AfterToolResult, BeforeToolArgs, BeforeToolResult, Hooks } from './hooks.js';
import type { RunEvent } from './event.js';
import type { RunOutcome } from './outcome.js';
import type { Store } from './store.js';

describe('contracts', () => {
  it('RunOutcome has exactly the five terminal statuses', () => {
    expectTypeOf<RunOutcome['status']>().toEqualTypeOf<'completed' | 'awaiting' | 'stopped' | 'cancelled' | 'failed'>();
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
