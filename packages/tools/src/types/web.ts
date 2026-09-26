export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** A search backend `web()` can offer as `web_search`; the first answers, the next when it fails. */
export interface SearchProvider {
  id: string;
  search(args: { query: string; count: number; signal: AbortSignal }): Promise<SearchResult[]>;
}

export interface WebOptions {
  /** `web_search` exists only when at least one is given, and asks them in this order. */
  search?: SearchProvider[];
  /** Milliseconds a fetch may take; default 20 000. */
  timeoutMs?: number;
  /** Bytes of a page kept when the call gives no `maxBytes`; default 262 144. */
  maxBytes?: number;
  /** The fetch to use; default the global one. */
  fetch?: typeof fetch;
  /** Resolves a host name to every address it has, checked before each fetch; default `node:dns/promises` `lookup` with `all: true`. */
  lookup?: Lookup;
}

/** A host name's addresses, as `node:dns/promises` `lookup` with `all: true` answers. */
export type Lookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

export interface WebFetchInput {
  url: string;
  maxBytes?: number;
}

export interface WebSearchInput {
  query: string;
  /** Results wanted; default 5, at most 20. */
  count?: number;
}

export interface BraveOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export interface TavilyOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export interface DuckDuckGoOptions {
  fetch?: typeof fetch;
}
