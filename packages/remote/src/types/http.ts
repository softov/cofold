import type { CookieJar } from "../auth.js";
export interface HttpTransportOptions {
  baseUrl: string;
  headers?: Readonly<Record<string, string>>;
  /** Injectable, so a test never opens a socket. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  auth?: { type: "basic"; username: string; password: string } | { type: "cookie"; jar: CookieJar };
  onResponse?(response: Response, url: URL): void | Promise<void>;
  onRequest?(request: { method: string; url: string }): void;
}
