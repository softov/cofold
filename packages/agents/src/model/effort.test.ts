import { describe, expect, it } from 'vitest';
import { EFFORT_LEVELS, effortOf } from './effort.js';

describe('effortOf', () => {
  it('gives the effort a level asks for', () => {
    expect(effortOf('low')).toBe('low');
    expect(effortOf('medium')).toBe('medium');
    expect(effortOf('high')).toBe('high');
  });

  it('sends nothing for off, a missing value or anything unknown', () => {
    expect(effortOf('off')).toBeUndefined();
    expect(effortOf(undefined)).toBeUndefined();
    expect(effortOf(null)).toBeUndefined();
    // `max` and `xhigh` are in the provider's range, not in the levels a host offers.
    expect(effortOf('max')).toBeUndefined();
    expect(effortOf('xhigh')).toBeUndefined();
    expect(effortOf(3)).toBeUndefined();
    expect(effortOf({ effort: 'high' })).toBeUndefined();
  });

  it('lists the four levels, off first, and sends every one but off as it is', () => {
    expect([...EFFORT_LEVELS]).toEqual(['off', 'low', 'medium', 'high']);
    expect(new Set(EFFORT_LEVELS).size).toBe(EFFORT_LEVELS.length);
    for (const level of EFFORT_LEVELS) {
      expect(effortOf(level)).toBe(level === 'off' ? undefined : level);
    }
  });
});
