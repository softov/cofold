import type { Capability, Tool } from '@cofold/agents';
import { createTool } from '@cofold/agents';
import type { SearchProvider, WebFetchInput, WebOptions, WebSearchInput } from './types/web.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_COUNT = 20;
const DEFAULT_COUNT = 5;
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|toml|x-sh)|image\/svg)/;

const RULES = 'web_fetch reads one page as plain text; the URL must be complete (https://...). Fetch the pages that answer the question; quote or cite them by URL.';
const SEARCH_RULES = 'web_search finds pages for a query and returns titles, URLs and snippets; search first, then web_fetch the results that look right.';

/**
 * The web capability: `web_fetch` (one page as text, size-capped), and `web_search` when at least one
 * `SearchProvider` is given (decision 7): the first that answers wins; a failing one is skipped.
 */
export function web(options: WebOptions = {}): Capability {
  const providers = options.search ?? [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'web',
    instructions: () => (providers.length ? `${SEARCH_RULES}\n${RULES}` : RULES),
    tools: () => [fetchTool({ timeoutMs, maxBytes, fetch: doFetch }), ...(providers.length ? [searchTool(providers)] : [])],
  };
}

function fetchTool(args: { timeoutMs: number; maxBytes: number; fetch: typeof fetch }): Tool<any, any> {
  return createTool<WebFetchInput>({
    name: 'web_fetch',
    description: `Fetch a URL (GET) and return the page as text: HTML is reduced to its text, JSON and other text types come verbatim. Cut at ${args.maxBytes} bytes unless told otherwise; ${args.timeoutMs / 1000} s timeout.`,
    input: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http or https, complete' },
        maxBytes: { type: 'integer', minimum: 1024, description: `Bytes to keep; default ${args.maxBytes}` },
      },
      required: ['url'],
      additionalProperties: false,
    },
    effects: { network: true },
    execute: async (input, ctx) => {
      const url = parseUrl(input.url);
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(args.timeoutMs)]);
      const response = await args.fetch(url, { signal, redirect: 'follow', headers: { accept: 'text/html, text/plain;q=0.9, application/json;q=0.8, */*;q=0.5' } })
        .catch((e: Error) => { throw new Error(`cannot fetch ${url}: ${signal.aborted ? `timed out after ${args.timeoutMs / 1000} s` : (e.cause as { code?: string } | undefined)?.code ?? e.message}`); });
      const type = (response.headers.get('content-type') ?? '').toLowerCase();
      const mime = type.split(';')[0]!.trim();
      if (mime !== '' && !TEXT_TYPES.test(mime)) throw new Error(`${url} is ${mime}, not text`);
      const cap = input.maxBytes ?? args.maxBytes;
      const { text, cut } = await readUpTo(response, cap);
      const body = mime === 'text/html' ? htmlToText(text) : text;
      const head = `${response.url || url} (${response.status}${mime ? `, ${mime}` : ''})`;
      return `${head}\n\n${body.trim()}${cut ? `\n[cut at ${cap} bytes]` : ''}`;
    },
  });
}

function searchTool(providers: SearchProvider[]): Tool<any, any> {
  return createTool<WebSearchInput>({
    name: 'web_search',
    description: `Search the web and get titles, URLs and snippets (${providers.map((p) => p.id).join(', then ')}). ${DEFAULT_COUNT} results by default, ${MAX_COUNT} at most.`,
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        count: { type: 'integer', minimum: 1, maximum: MAX_COUNT },
      },
      required: ['query'],
      additionalProperties: false,
    },
    effects: { network: true },
    execute: async (input, ctx) => {
      const count = input.count ?? DEFAULT_COUNT;
      const failures: string[] = [];
      for (const provider of providers) {
        if (ctx.signal.aborted) break;
        try {
          const results = (await provider.search({ query: input.query, count, signal: ctx.signal })).slice(0, count);
          if (results.length === 0) return `no results for "${input.query}" (${provider.id})`;
          return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${fold(r.snippet)}` : ''}`).join('\n');
        } catch (e) {
          failures.push(`${provider.id}: ${(e as Error).message}`);
        }
      }
      throw new Error(`web_search failed: ${failures.join('; ')}`);
    },
  });
}

function parseUrl(text: string): string {
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`"${text}" is not a URL`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${text}: only http and https are fetched`);
  return url.href;
}

/** The body as text, at most `cap` bytes of it; the rest of the stream is cancelled. */
async function readUpTo(response: Response, cap: number): Promise<{ text: string; cut: boolean }> {
  if (response.body === null) return { text: '', cut: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  while (!done && size < cap) {
    const next = await reader.read();
    done = next.done;
    if (!done) { chunks.push(next.value); size += next.value.byteLength; }
  }
  // Exactly at the cap: one more read says whether anything was left.
  const cut = size > cap || (!done && !(await reader.read()).done);
  await reader.cancel().catch(() => undefined);
  return { text: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, cap)), cut };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', mdash: '-', ndash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

/** HTML to readable text: scripts, styles and tags gone, block ends as line breaks, entities decoded, whitespace folded. */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const text = html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ')
    // Source line breaks mean nothing outside <pre>; keep those as <br> before folding.
    .replace(/<pre\b[\s\S]*?<\/pre\s*>/gi, (block) => block.replace(/\r?\n/g, '<br>'))
    .replace(/\s+/g, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|h[1-6]|blockquote|pre|table)\s*>/gi, '\n\n')
    .replace(/<\/(div|li|tr|section|article|header|footer|nav|ul|ol|dd|dt)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  const folded = decode(text).split('\n').map((line) => line.replace(/ +/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return title ? `${decode(title).replace(/\s+/g, ' ').trim()}\n\n${folded}` : folded;
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function fold(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
