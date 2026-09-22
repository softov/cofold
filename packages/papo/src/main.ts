#!/usr/bin/env node
import { runEntry } from '@doopx/terminal';
import { argvFor, createProgram } from './program.js';

/**
 * The entry point, and the one decision it makes: the screen or the shell.
 *
 * The screen is a command like the others (`papo chat`), reached also by a bare `papo`. Its module
 * pulls in a whole renderer, so it is imported only when that command runs; `papo session list`
 * never pays for one.
 */
const program = createProgram({
  openScreen: async (papo, sessionId) => {
    const { openScreen } = await import('./screen/tui.js');
    await openScreen(papo, sessionId);
  },
});
const argv = argvFor(program, process.argv.slice(2));

// A closed pipe is not an error: `papo session list | head` cuts the writer short.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await runEntry(program, argv);
