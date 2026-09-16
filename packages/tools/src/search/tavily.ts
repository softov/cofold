import type { SearchProvider, SearchResult, TavilyOptions } from '../types/web.js';
import { checked } from './http.js';

const ENDPOINT = 'https://api.tavily.com/search';

interface TavilyResponse {
  answer?: string;
  results?: { title?: string; url?: string; content?: string }[];
}

/** Tavily (https://tavily.com): a key, 10 results at most per call; its synthesized answer comes first when present. */
export function tavily(options: TavilyOptions): SearchProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'tavily',
    async search({ query, count, signal }) {
      const response = await checked('tavily', doFetch(ENDPOINT, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ query, max_results: Math.min(count, 10), search_depth: 'basic', include_answer: true, include_raw_content: false }),
      }));
      const data = (await response.json()) as TavilyResponse;
      const results = (data.results ?? []).flatMap((r): SearchResult[] => (r.url && r.title ? [{ title: r.title, url: r.url, snippet: r.content ?? '' }] : []));
      return data.answer ? [{ title: `Answer: ${query}`, url: 'https://tavily.com', snippet: data.answer }, ...results] : results;
    },
  };
}
