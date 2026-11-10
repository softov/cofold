import type { AppIdentity } from './types/options.js';

/** This package's version, as `package.json` has it; `app.test.ts` fails when the two differ. */
export const VERSION = '0.2.1';

/** Who calls when the program names nobody. */
export const DEFAULT_APP: AppIdentity = { name: 'cofold', version: VERSION, url: 'https://github.com/softov/cofold' };

/** OpenRouter's host, and every host under it. */
function isOpenRouter(baseUrl: string): boolean {
  let host: string;
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return false; }
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
}

/**
 * The headers that name the app: `user-agent` on every request, and to OpenRouter the two its app
 * attribution reads, `http-referer` and `x-openrouter-title` (https://openrouter.ai/docs/app-attribution).
 */
export function appHeaders(app: AppIdentity, baseUrl: string): Record<string, string> {
  return {
    'user-agent': `${app.name}/${app.version}`,
    ...(isOpenRouter(baseUrl) ? { 'http-referer': app.url, 'x-openrouter-title': app.name } : {}),
  };
}

/** `base` with `over` on top, where a name of `over` replaces the same name of `base` in any case. */
export function mergeHeaders(base: Record<string, string>, over: Record<string, string> | undefined): Record<string, string> {
  if (over === undefined) return base;
  const replaced = new Set(Object.keys(over).map((name) => name.toLowerCase()));
  const kept = Object.fromEntries(Object.entries(base).filter(([name]) => !replaced.has(name.toLowerCase())));
  return { ...kept, ...over };
}
