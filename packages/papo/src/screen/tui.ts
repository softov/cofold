import { WRITER_KEY, createApp } from '@textui/core';
import { createNodeTerminal, createWriter, renderStill } from '@textui/terminal';
import type { Papo } from '../commands.js';
import { registerPapo } from './app.js';

/**
 * The screen, in a terminal.
 *
 * Not a terminal: one frame to stdout and out, so `papo chat | cat` and a CI log get something to
 * read rather than a hung process holding raw mode. Otherwise the application runs until its own
 * quit key; every path out stops it first, because exiting from the alternate screen with the
 * cursor hidden leaves a shell nobody can type into.
 */
export async function openScreen(papo: Papo, sessionId: string | undefined): Promise<void> {
  const { theme, shell } = papo.config;
  if (!process.stdout.isTTY) {
    const { text } = await renderStill({
      width: process.stdout.columns ?? 100,
      height: process.stdout.rows ?? 30,
      theme,
      shell,
      onBoot: (booted) => registerPapo(booted, { papo, ...(sessionId !== undefined ? { sessionId } : {}) }),
    });
    await papo.chat.close();
    process.stdout.write(`${text}\n`);
    return;
  }

  const terminal = createNodeTerminal();
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const app = createApp({
    terminal,
    theme,
    shell,
    session: { managed: true, altScreen: true, mouse: true, title: 'papo' },
    onBoot: (booted) => registerPapo(booted, {
      papo,
      ...(sessionId !== undefined ? { sessionId } : {}),
      onQuit: () => { void app.stop().then(() => papo.chat.close()).finally(finish); },
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
