import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPAPO_APP, VERSION, providersFor } from './app.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('the app copapo names', () => {
  it('is copapo on every provider, and OpenRouter gets the repository and the title', async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { seen.push(init ?? {}); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }));
    const providers = providersFor({ providers: [{ id: 'or', baseUrl: 'https://openrouter.ai/api/v1' }, { id: 'lm', baseUrl: 'http://localhost:1234/v1' }] });
    await providers.get('or')!.listModels();
    await providers.get('lm')!.listModels();
    expect(seen[0]!.headers).toMatchObject({ 'user-agent': `copapo/${VERSION}`, 'http-referer': 'https://github.com/softov/cofold', 'x-openrouter-title': 'copapo' });
    expect(seen[1]!.headers).toMatchObject({ 'user-agent': `copapo/${VERSION}` });
    expect(seen[1]!.headers).not.toHaveProperty('x-openrouter-title');
    expect(COPAPO_APP.version).toBe(VERSION);
  });

  it('carries the version package.json has', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
