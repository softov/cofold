import { describe, expect, it } from 'vitest';
import { createWarnings } from './warnings.js';

describe('warnings', () => {
  it('go to the writer, to a listener while one is set, and back after', () => {
    const written: string[] = [];
    const heard: string[] = [];
    const warnings = createWarnings((message) => written.push(message));
    warnings.warn('one');
    const restore = warnings.divert((message) => heard.push(message));
    warnings.warn('two');
    restore();
    warnings.warn('three');
    expect(written).toEqual(['one', 'three']);
    expect(heard).toEqual(['two']);
  });

  it('a stale restore leaves a newer listener in place', () => {
    const heard: string[] = [];
    const warnings = createWarnings(() => {});
    const first = warnings.divert(() => {});
    warnings.divert((message) => heard.push(message));
    first();
    warnings.warn('kept');
    expect(heard).toEqual(['kept']);
  });
});
