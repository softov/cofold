#!/usr/bin/env node
import { runEntry } from '@cofold/terminal';
import { argvFor, createProgram } from './program.js';

/**
 * The entry point, and the one decision it makes: the screen or the shell.
 *
 * The screen is a command like the others (`copapo chat`), reached also by a bare `copapo`. Its module
 * pulls in a whole renderer, so it is imported only when that command runs; `copapo session list`
 * never pays for one.
 */
const program = createProgram({
  openScreen: async (copapo, sessionId) => {
    const { openScreen } = await import('./screen/tui.js');
    await openScreen(copapo, sessionId);
  },
});
const argv = argvFor(program, process.argv.slice(2));

// A closed pipe is not an error: `copapo session list | head` cuts the writer short.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await runEntry(program, argv);
