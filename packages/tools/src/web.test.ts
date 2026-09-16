import { describe, expect, it } from 'vitest';
import type { CapabilityArgs, Tool, ToolContext } from '@facio/agents';
import { createMemoryStore } from '@facio/agents';
import type { SearchProvider } from './types/web.js';
import { htmlToText, web } from './web.js';
import { brave } from './search/brave.js';
import { tavily } from './search/tavily.js';
import { duckduckgo, parseResults } from './search/duckduckgo.js';

const store = createMemoryStore();
const kv = { agent: store.kv({ kind: 'agent', agentId: 't' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) };
const signal = new AbortController().signal;
const ctx: ToolContext = { agentId: 't', sessionId: 's', runId: 'r', callId: 'c', invocationId: 'i', signal, kv, resources: {} };
const args: CapabilityArgs = { agentId: 't', sessionId: 's', runId: 'r', kv, signal };

const PAGE = `<!doctype html><html><head><title>Docs &amp; more</title><style>p{}</style><script>var x = "<p>";</script></head>
<body><nav><a href="/">Home</a></nav><h1>Hello</h1><p>First   paragraph with <b>bold</b> &amp; an &#39;entity&#39;.</p>
<ul><li>one</li><li>two</li></ul><!-- a comment --><p>Last.</p></body></html>`;

/** A fetch answering from a table; records what it was asked. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, ...(init !== undefined ? { init } : {}) });
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    return routes[key]!();
  }) as typeof fetch;
  return { fetch: doFetch, calls };
}

const toolsOf = async (capability: ReturnType<typeof web>) => new Map((await capability.tools!(args)).map((t) => [t.name, t]));
const call = (tool: Tool<any, any> | undefined, input: unknown) => Promise.resolve(tool!.execute(input, ctx));

describe('htmlToText', () => {
  it('keeps the title and the text, drops scripts, styles and tags, decodes entities, folds whitespace', () => {
    expect(htmlToText(PAGE)).toBe('Docs & more\n\nHome\nHello\n\nFirst paragraph with bold & an \'entity\'.\n\n- one\n- two\n\nLast.');
  });
});

describe('web()', () => {
  it('offers web_fetch alone without a provider, and web_search with one', async () => {
    expect([...(await toolsOf(web())).keys()]).toEqual(['web_fetch']);
    expect(await web().instructions!(args)).not.toContain('web_search');
    const withSearch = web({ search: [duckduckgo()] });
    expect([...(await toolsOf(withSearch)).keys()]).toEqual(['web_fetch', 'web_search']);
    expect(await withSearch.instructions!(args)).toContain('web_search');
    expect((await toolsOf(withSearch)).get('web_search')!.description).toContain('(duckduckgo)');
  });

  it('web_fetch reduces HTML to text, passes other text through, refuses binary and bad URLs, and caps the body', async () => {
    const { fetch: doFetch } = fakeFetch({
      'https://docs.example/': () => new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      'https://api.example/data': () => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }),
      'https://img.example/': () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
      'https://big.example/': () => new Response('x'.repeat(5000), { headers: { 'content-type': 'text/plain' } }),
      'https://gone.example/': () => new Response('not here', { status: 404, headers: { 'content-type': 'text/plain' } }),
    });
    const tools = await toolsOf(web({ fetch: doFetch }));
    const fetchTool = tools.get('web_fetch');
    expect(await call(fetchTool, { url: 'https://docs.example/' })).toBe('https://docs.example/ (200, text/html)\n\nDocs & more\n\nHome\nHello\n\nFirst paragraph with bold & an \'entity\'.\n\n- one\n- two\n\nLast.');
    expect(await call(fetchTool, { url: 'https://api.example/data' })).toBe('https://api.example/data (200, application/json)\n\n{"a":1}');
    expect(await call(fetchTool, { url: 'https://gone.example/' })).toBe('https://gone.example/ (404, text/plain)\n\nnot here');
    expect(await call(fetchTool, { url: 'https://big.example/', maxBytes: 1024 })).toBe(`https://big.example/ (200, text/plain)\n\n${'x'.repeat(1024)}\n[cut at 1024 bytes]`);
    await expect(call(fetchTool, { url: 'https://img.example/' })).rejects.toThrow('https://img.example/ is image/png, not text');
    await expect(call(fetchTool, { url: 'ftp://x' })).rejects.toThrow('only http and https are fetched');
    await expect(call(fetchTool, { url: 'not a url' })).rejects.toThrow('"not a url" is not a URL');
    await expect(call(fetchTool, { url: 'https://down.example/' })).rejects.toThrow('cannot fetch https://down.example/: ENOTFOUND');
  });

  it('web_search formats the first answering provider and fails over past a failing one', async () => {
    const failing: SearchProvider = { id: 'first', search: async () => { throw new Error('HTTP 429 rate limited'); } };
    const answering: SearchProvider = {
      id: 'second',
      search: async ({ query, count }) => [
        { title: `About ${query}`, url: 'https://a.example/', snippet: 'A  snippet\nwith   space' },
        { title: 'Two', url: 'https://b.example/', snippet: '' },
        { title: 'Three', url: 'https://c.example/', snippet: 'dropped when count is 2' },
      ].slice(0, count + 1),
    };
    const search = (await toolsOf(web({ search: [failing, answering] }))).get('web_search');
    expect(await call(search, { query: 'facio', count: 2 })).toBe('1. About facio\n   https://a.example/\n   A snippet with space\n2. Two\n   https://b.example/');
    const none = (await toolsOf(web({ search: [failing] }))).get('web_search');
    await expect(call(none, { query: 'facio' })).rejects.toThrow('web_search failed: first: HTTP 429 rate limited');
    const empty = (await toolsOf(web({ search: [{ id: 'e', search: async () => [] }] }))).get('web_search');
    expect(await call(empty, { query: 'nothing' })).toBe('no results for "nothing" (e)');
  });
});

describe('the shipped providers', () => {
  it('brave sends the key and parses web.results', async () => {
    const { fetch: doFetch, calls } = fakeFetch({
      'https://api.search.brave.com/res/v1/web/search': () => Response.json({ web: { results: [{ title: 'T', url: 'https://t.example/', description: 'D' }, { title: 'no url' }] } }),
    });
    const results = await brave({ apiKey: 'k', fetch: doFetch }).search({ query: 'q q', count: 3, signal });
    expect(results).toEqual([{ title: 'T', url: 'https://t.example/', snippet: 'D' }]);
    expect(calls[0]!.url).toBe('https://api.search.brave.com/res/v1/web/search?q=q+q&count=3');
    expect((calls[0]!.init!.headers as Record<string, string>)['x-subscription-token']).toBe('k');
  });

  it('tavily posts the query and puts its answer first', async () => {
    const { fetch: doFetch, calls } = fakeFetch({
      'https://api.tavily.com/search': () => Response.json({ answer: 'Because.', results: [{ title: 'R', url: 'https://r.example/', content: 'C' }] }),
    });
    const results = await tavily({ apiKey: 'k', fetch: doFetch }).search({ query: 'why', count: 5, signal });
    expect(results).toEqual([{ title: 'Answer: why', url: 'https://tavily.com', snippet: 'Because.' }, { title: 'R', url: 'https://r.example/', snippet: 'C' }]);
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ query: 'why', max_results: 5 });
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('duckduckgo parses the results page and names an HTTP failure', async () => {
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.example%2Fpage&amp;rut=abc">One <b>bold</b></a>
      <a class="result__snippet" href="x">Snippet &amp; more</a></div>
      <div class="result"><a class="result__a" href="https://two.example/">Two</a><a class="result__snippet">S2</a></div>`;
    expect(parseResults(html)).toEqual([
      { title: 'One bold', url: 'https://one.example/page', snippet: 'Snippet & more' },
      { title: 'Two', url: 'https://two.example/', snippet: 'S2' },
    ]);
    const ok = fakeFetch({ 'https://html.duckduckgo.com/html/': () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
    expect(await duckduckgo({ fetch: ok.fetch }).search({ query: 'x', count: 1, signal })).toHaveLength(1);
    const blocked = fakeFetch({ 'https://html.duckduckgo.com/html/': () => new Response('<h1>Forbidden</h1>\nmore', { status: 403 }) });
    await expect(duckduckgo({ fetch: blocked.fetch }).search({ query: 'x', count: 1, signal })).rejects.toThrow('duckduckgo: HTTP 403 <h1>Forbidden</h1>');
  });
});
