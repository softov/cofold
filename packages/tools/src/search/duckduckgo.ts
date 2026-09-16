import type { DuckDuckGoOptions, SearchProvider, SearchResult } from '../types/web.js';
import { checked } from './http.js';

const ENDPOINT = 'https://html.duckduckgo.com/html/';
const RESULT = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

/** DuckDuckGo's HTML results page, scraped: no key, and it breaks the day the page changes. */
export function duckduckgo(options: DuckDuckGoOptions = {}): SearchProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'duckduckgo',
    async search({ query, count, signal }) {
      const url = `${ENDPOINT}?${new URLSearchParams({ q: query })}`;
      const response = await checked('duckduckgo', doFetch(url, { signal, headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; facio/0.1)' } }));
      return parseResults(await response.text()).slice(0, count);
    },
  };
}

/** The results in the page; exported so a fixture can pin the format. */
export function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const match of html.matchAll(RESULT)) {
    const url = targetOf(match[1]!);
    const title = strip(match[2]!);
    if (title && url.startsWith('http')) results.push({ title, url, snippet: strip(match[3]!) });
  }
  return results;
}

/** DuckDuckGo links through `/l/?uddg=<encoded target>&rut=...`. */
function targetOf(href: string): string {
  const encoded = /[?&]uddg=([^&]+)/.exec(href)?.[1];
  return encoded ? decodeURIComponent(encoded) : href.startsWith('//') ? `https:${href}` : href;
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
