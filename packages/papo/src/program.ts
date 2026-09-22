import type { Io } from '@doopx/commands';
import { matchCommand, optionTable, tokenize } from '@doopx/commands';
import { Program } from '@doopx/terminal';
import { GLOBALS, createPapoRegistry } from './commands.js';
import type { RegistryOptions } from './commands.js';

export const VERSION = '0.0.1';

export interface ProgramArgs extends RegistryOptions {
  io?: Io;
}

export function createProgram(args: ProgramArgs = {}): Program {
  const { io, ...registryOptions } = args;
  const registry = createPapoRegistry(registryOptions);
  return new Program({
    ...(io !== undefined ? { io } : {}),
    name: 'papo',
    version: VERSION,
    description: 'Talk to an agent that runs in this process: a screen, or one command at a time.',
    registry,
    globals: GLOBALS,
  });
}

/**
 * `papo` alone, or with only options, means the screen.
 *
 * Decided by the program's own grammar rather than a scan of the first word: an option that takes a
 * value must not have that value read as a command, which is what every hand-written scan gets
 * wrong once. `--help` and `--version` are words the program answers itself.
 */
export function argvFor(program: Program, argv: readonly string[]): string[] {
  const table = optionTable(program.globals, true);
  const tokens = tokenize(table, argv, { permissive: true });
  if (tokens.words.length > 0) return [...argv];
  if (argv.some((word) => word === '--help' || word === '-h' || word === '--version' || word === '-V')) return [...argv];
  if (matchCommand(program.commands, ['chat']) === null) return [...argv];
  return ['chat', ...argv];
}
