import type { BraveOptions, SearchProvider, SearchResult } from '../types/web.js';
import { checked } from './http.js';

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

interface BraveResponse {
  web?: { results?: { title?: string; url?: string; description?: string }[] };
}

/** Brave Search (https://brave.com/search/api/): a key, 20 results at most per call. */
export function brave(options: BraveOptions): SearchProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'brave',
    async search({ query, count, signal }) {
      const url = `${ENDPOINT}?${new URLSearchParams({ q: query, count: String(Math.min(count, 20)) })}`;
      const response = await checked('brave', doFetch(url, { signal, headers: { accept: 'application/json', 'x-subscription-token': options.apiKey } }));
      const data = (await response.json()) as BraveResponse;
      return (data.web?.results ?? []).flatMap((r): SearchResult[] => (r.url && r.title ? [{ title: r.title, url: r.url, snippet: r.description ?? '' }] : []));
    },
  };
}
