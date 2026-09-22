import { describe, expect, it } from 'vitest';
import type { ReasoningEffort } from '@cofold/agents';
import { toWireReasoning } from './wire.js';

const LEVELS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

describe('toWireReasoning (decision 98)', () => {
  it('sends an effort alone as reasoning_effort, for every level', () => {
    for (const effort of LEVELS) expect(toWireReasoning({ effort })).toEqual({ reasoning_effort: effort });
    expect(toWireReasoning({})).toEqual({});
  });

  it('sends the reasoning object as soon as maxTokens is set, with the effort when there is one', () => {
    expect(toWireReasoning({ maxTokens: 512 })).toEqual({ reasoning: { max_tokens: 512 } });
    expect(toWireReasoning({ effort: 'high', maxTokens: 512 })).toEqual({ reasoning: { effort: 'high', max_tokens: 512 } });
    expect(toWireReasoning({ effort: 'high', maxTokens: 512 }, { high: 1 })).toEqual({ reasoning: { effort: 'high', max_tokens: 512 } });
  });

  it('turns an effort into the provider budget for that level, and leaves unbudgeted levels alone', () => {
    const budgets = { low: 1_000, xhigh: 32_000 };
    expect(toWireReasoning({ effort: 'low' }, budgets)).toEqual({ reasoning: { max_tokens: 1_000 } });
    expect(toWireReasoning({ effort: 'xhigh' }, budgets)).toEqual({ reasoning: { max_tokens: 32_000 } });
    expect(toWireReasoning({ effort: 'max' }, budgets)).toEqual({ reasoning_effort: 'max' });
    expect(toWireReasoning({}, budgets)).toEqual({});
  });
});
