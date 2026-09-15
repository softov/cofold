import { homedir } from 'node:os';
import { join } from 'node:path';

/** `<NAME>_HOME` when set, else `~/.<name>` (parent decision 29: the host owns the root). */
export function resolveHome(args: { name: string; env?: NodeJS.ProcessEnv }): string {
  const env = args.env ?? process.env;
  const key = `${args.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_HOME`;
  return env[key] ?? join(homedir(), `.${args.name}`);
}
