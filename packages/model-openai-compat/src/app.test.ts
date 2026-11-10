import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP, VERSION, openaiCompat, providersOf } from './index.js';

const reply = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });

/** The headers of the one request a model sends to `baseUrl`. */
async function headersAt(baseUrl: string, extra: { app?: typeof DEFAULT_APP; headers?: Record<string, string> } = {}): Promise<Record<string, string>> {
  const seen: RequestInit[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { seen.push(init ?? {}); return reply(); }) as unknown as typeof globalThis.fetch;
  await openaiCompat({ baseUrl, model: 'm', fetch, features: { streaming: false }, ...extra })
    .complete({ instructions: '', messages: [], tools: [], params: {} } as never);
  return seen[0]!.headers as Record<string, string>;
}

describe('the app a request names', () => {
  it('is cofold by default, as User-Agent only, away from OpenRouter', async () => {
    const headers = await headersAt('http://localhost:1234/v1');
    expect(headers['user-agent']).toBe(`cofold/${VERSION}`);
    expect(headers).not.toHaveProperty('http-referer');
    expect(headers).not.toHaveProperty('x-openrouter-title');
  });

  it('gives OpenRouter the URL and the title too', async () => {
    const app = { name: 'copapo', version: '1.2.3', url: 'https://github.com/softov/cofold' };
    const headers = await headersAt('https://openrouter.ai/api/v1', { app });
    expect(headers).toMatchObject({ 'user-agent': 'copapo/1.2.3', 'http-referer': 'https://github.com/softov/cofold', 'x-openrouter-title': 'copapo' });
    expect(await headersAt('https://eu.openrouter.ai/api/v1', { app })).toHaveProperty('x-openrouter-title', 'copapo');
    expect(await headersAt('https://notopenrouter.ai/api/v1', { app })).not.toHaveProperty('x-openrouter-title');
  });

  it('gives way to a provider header of the same name in any case', async () => {
    const headers = await headersAt('https://openrouter.ai/api/v1', { headers: { 'User-Agent': 'mine', 'X-OpenRouter-Title': 'Mine' } });
    expect(headers).toMatchObject({ 'User-Agent': 'mine', 'X-OpenRouter-Title': 'Mine', 'http-referer': DEFAULT_APP.url });
    expect(headers).not.toHaveProperty('user-agent');
    expect(headers).not.toHaveProperty('x-openrouter-title');
  });

  it('reaches every provider providersOf builds', async () => {
    const seen: RequestInit[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { seen.push(init ?? {}); return new Response(JSON.stringify({ data: [] }), { status: 200 }); });
    vi.stubGlobal('fetch', fetch);
    try {
      const providers = providersOf([{ id: 'or', baseUrl: 'https://openrouter.ai/api/v1' }], { app: { name: 'ahpd', version: '0.15.0', url: 'https://ahpio.com' } });
      await providers.get('or')!.listModels();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen[0]!.headers).toMatchObject({ 'user-agent': 'ahpd/0.15.0', 'http-referer': 'https://ahpio.com', 'x-openrouter-title': 'ahpd' });
  });

  it('carries the version package.json has', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
