export interface CacheOptions {
  directory: string;
  /** How long before a refresh is attempted. A day suits a surface that changes on deploys. */
  ttlMs?: number;
  /** `--refresh`: ignore what is cached, but still fall back to it if the fetch fails. */
  refresh?: boolean;
  fetch?: typeof globalThis.fetch;
  headers?: Readonly<Record<string, string>>;
  warn?(message: string): void;
}
