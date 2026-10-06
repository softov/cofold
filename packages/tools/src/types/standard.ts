/** The search backends `web_search` may use, asked in the order the configuration writes them (decision 123). */
export interface SearchConfig {
  /** Brave Search; a key. */
  brave?: { apiKey: string };
  /** Tavily; a key. */
  tavily?: { apiKey: string };
  /** The HTML results page, scraped; no key. */
  duckduckgo?: boolean;
}

/** Which standard capabilities a run gets; a key left out is on (decision 123). */
export interface ToolsConfig {
  files?: boolean;
  shell?: boolean;
  /** `true` is `web_fetch` alone; an object adds `web_search` over its providers. */
  web?: boolean | { search?: SearchConfig };
  memory?: boolean;
}
