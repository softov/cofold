import { WRITER_KEY, createApp } from '@textui/core';
import { createNodeTerminal, createWriter, renderStill } from '@textui/terminal';
import type { Copapo } from '../commands.js';
import { registerCopapo } from './app.js';

/**
 * The screen, in a terminal.
 *
 * Not a terminal: one frame to stdout and out, so `copapo chat | cat` and a CI log get something to
 * read rather than a hung process holding raw mode. Otherwise the application runs until its own
 * quit key; every path out stops it first, because exiting from the alternate screen with the
 * cursor hidden leaves a shell nobody can type into.
 */
export async function openScreen(copapo: Copapo, sessionId: string | undefined, reopen?: (trusted: boolean) => Copapo): Promise<void> {
  const { theme, shell } = copapo.config;
  if (!process.stdout.isTTY) {
    const { text } = await renderStill({
      width: process.stdout.columns ?? 100,
      height: process.stdout.rows ?? 30,
      theme,
      shell,
      onBoot: (booted) => registerCopapo(booted, { copapo, ...(sessionId !== undefined ? { sessionId } : {}) }),
    });
    await copapo.chat.close();
    process.stdout.write(`${text}\n`);
    return;
  }

  // What the trust answer opened, closed with the screen as `copapo` is.
  const reopened: Copapo[] = [];
  const reopenAndKeep = reopen === undefined ? undefined : (trusted: boolean): Copapo => {
    const next = reopen(trusted);
    reopened.push(next);
    return next;
  };
  const closeAll = async (): Promise<void> => {
    await Promise.all([copapo, ...reopened].map((one) => one.chat.close()));
  };
  const terminal = createNodeTerminal();
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const app = createApp({
    terminal,
    theme,
    shell,
    session: { managed: true, altScreen: true, mouse: true, title: 'copapo' },
    onBoot: (booted) => registerCopapo(booted, {
      copapo,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(reopenAndKeep !== undefined ? { reopen: reopenAndKeep } : {}),
      onQuit: () => { void app.stop().then(closeAll).finally(finish); },
    }),
  });
  app.services.provide(WRITER_KEY, createWriter(terminal.capabilities()));

  const bail = (label: string) => (error: unknown): void => {
    void app.stop().finally(() => {
      process.stderr.write(`${label}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    });
  };
  process.on('unhandledRejection', bail('Unhandled rejection'));
  process.on('uncaughtException', bail('Uncaught exception'));

  await app.start();
  await done;
}
