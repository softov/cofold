import type { AgentError } from '@cofold/agents';
import type { SchemaResult } from '@cofold/sdk';
import { describe, expect, it } from 'vitest';
import { validateSchema } from '@cofold/sdk';
import { PROVIDER_SCHEMA, providerFor, providersOf, splitModel } from './config.js';
import type { ProviderConfig } from './types/config.js';

const TWO: ProviderConfig[] = [{ id: 'a', baseUrl: 'http://a/v1' }, { id: 'b', baseUrl: 'http://b/v1' }];
const valid = (value: unknown): SchemaResult => validateSchema({ schema: PROVIDER_SCHEMA, value });

/** The error a throw produced, for its code and message. */
function thrown(fn: () => unknown): AgentError {
  try { fn(); } catch (e) { return e as AgentError; }
  throw new Error('did not throw');
}

describe('splitModel', () => {
  it('splits at the first slash only, and answers undefined for what is not a reference', () => {
    expect(splitModel('or/qwen/qwen3-8b')).toEqual({ provider: 'or', modelId: 'qwen/qwen3-8b' });
    expect(splitModel('lm/qwen')).toEqual({ provider: 'lm', modelId: 'qwen' });
    // The three shapes a host reads as "not a reference" rather than as a mistake (ahpd's answer).
    expect(splitModel('qwen')).toBeUndefined();
    expect(splitModel('or/')).toBeUndefined();
    expect(splitModel('/m')).toBeUndefined();
    expect(splitModel('')).toBeUndefined();
  });
});

describe('providersOf', () => {
  it('keys one provider per entry by its id, in the configuration order', () => {
    const providers = providersOf(TWO);
    expect([...providers.keys()]).toEqual(['a', 'b']);
    expect([...providers.values()].map((provider) => provider.id)).toEqual(['openai-compat:a', 'openai-compat:b']);
    expect(providers.size).toBe(2);
  });

  it('names each provider by its configured id rather than by its host', () => {
    // The host of this URL is `localhost:1234`; the id a model reference uses is the one the file wrote.
    const providers = providersOf([{ id: 'lm', baseUrl: 'http://localhost:1234/v1' }]);
    expect([...providers.keys()]).toEqual(['lm']);
    expect(providers.get('lm')!.id).toBe('openai-compat:lm');
  });
});

describe('providerFor', () => {
  it('finds the provider a reference names, and says what is configured when it is missing', () => {
    const providers = providersOf(TWO);
    expect(providerFor(providers, 'b/m')).toEqual({ provider: providers.get('b'), modelId: 'm' });
    expect(providerFor(providers, 'a/qwen/qwen3-8b').modelId).toBe('qwen/qwen3-8b');

    const missing = thrown(() => providerFor(providers, 'c/m'));
    expect(missing.code).toBe('invalid_options');
    expect(missing.message).toBe('model "c/m" names provider "c"; configured: a, b');
    expect(() => providerFor(new Map(), 'c/m')).toThrow('no provider is configured');
    // A reference with no slash is refused before any provider is looked up, so the message is about the shape.
    expect(() => providerFor(providers, 'qwen')).toThrow('model "qwen" must be written <provider>/<model>');
    expect(thrown(() => providerFor(new Map(), 'qwen')).code).toBe('invalid_options');
  });
});

describe('PROVIDER_SCHEMA', () => {
  it('takes a sample entry, with and without the optional fields', () => {
    expect(valid({ id: 'lm', baseUrl: 'http://localhost:1234/v1' }).ok).toBe(true);
    expect(valid({ id: 'or', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', headers: { 'x-a': 'b' } }).ok).toBe(true);
    expect(valid({ id: 'default', baseUrl: 'http://lm', apiKey: '' }).ok).toBe(true);
  });

  it('refuses a missing baseUrl, a missing id, an id with a slash or a space, and an unknown key', () => {
    expect(valid({ id: 'lm' }).ok).toBe(false);
    expect(valid({ baseUrl: 'http://lm' }).ok).toBe(false);
    expect(valid({ id: 'a/b', baseUrl: 'http://lm' }).ok).toBe(false);
    expect(valid({ id: 'a b', baseUrl: 'http://lm' }).ok).toBe(false);
    expect(valid({ id: '', baseUrl: 'http://lm' }).ok).toBe(false);
    expect(valid({ id: 'lm', baseUrl: 'http://lm', extra: 1 }).ok).toBe(false);
    // The issue names the key, which is what a program shows.
    const failed = valid({ id: 'lm', baseUrl: '' });
    expect(failed.ok === false && failed.issues).toEqual([{ path: '$.baseUrl', message: 'shorter than 1' }]);
  });
});
