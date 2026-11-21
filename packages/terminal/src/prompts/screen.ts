import { keysOf } from "../keys.js";
import type { TerminalKey } from "../types/keys.js";
import type { PromptMachine, PromptScreen, PromptScreenOptions } from "../types/prompts.js";

/** Thrown by a prompt the person backed out of: ctrl-c, ctrl-d or escape. */
export class PromptCancelled extends Error {
  constructor(message = "Cancelled.") {
    super(message);
    this.name = "PromptCancelled";
  }
}


const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/gu;

/** The columns `text` takes on screen, not counting colour codes. */
export const visibleLength = (text: string): number => [...text.replace(ANSI, "")].length;

/**
 * `text` cut to `width` columns, colour codes kept whole.
 *
 * A line that wraps is a line the cursor-up count is wrong about, so every
 * live line is cut before it is drawn; the cut ends in a reset so a style
 * opened in the cut half cannot run into the next line.
 */
export function fit(text: string, width: number, ellipsis: string): string {
  if (visibleLength(text) <= width) return text;
  const room = Math.max(1, width - ellipsis.length);
  let out = "";
  let shown = 0;
  let at = 0;
  while (at < text.length && shown < room) {
    const code = /^\x1b\[[0-9;?]*[ -/]*[@-~]/u.exec(text.slice(at));
    if (code !== null) {
      out += code[0];
      at += code[0].length;
      continue;
    }
    const char = [...text.slice(at)][0] as string;
    out += char;
    at += char.length;
    shown += 1;
  }
  return `${out}${ellipsis}\x1b[0m`;
}



export function createScreen(options: PromptScreenOptions): PromptScreen {
  const { input, output } = options;
  // Keys typed ahead, or arriving in the same chunk as the key that ended a prompt, wait here for the next one.
  const pending: TerminalKey[] = [];
  const width = (): number => Math.max(20, (output.columns ?? 80) - 1);

  return {
    width,
    print(lines) {
      if (lines.length > 0) output.write(`${lines.map((line) => fit(line, width(), options.ellipsis)).join("\n")}\n`);
    },
    run<S, R>(machine: PromptMachine<S, R>): Promise<R> {
      return new Promise<R>((resolve, reject) => {
        let state = machine.init;
        let drawn = 0;
        const erase = (): void => {
          if (drawn > 0) output.write(`\x1b[${drawn}A\r\x1b[J`);
          drawn = 0;
        };
        const draw = (): void => {
          const lines = machine.view(state).map((line) => fit(line, width(), options.ellipsis));
          output.write(`${lines.join("\n")}\n`);
          drawn = lines.length;
        };
        let finished = false;
        const finish = (settle: () => void): void => {
          finished = true;
          input.removeListener("data", onData);
          input.setRawMode?.(false);
          input.pause();
          output.write("\x1b[?25h");
          settle();
        };
        const feed = (): void => {
          while (!finished && pending.length > 0) {
            const key = pending.shift() as TerminalKey;
            if (key.name === "ctrl-c" || key.name === "ctrl-d" || key.name === "escape") {
              erase();
              finish(() => { reject(new PromptCancelled()); });
              return;
            }
            const next = machine.step(state, key);
            erase();
            if ("done" in next) {
              finish(() => { resolve(next.done); });
              return;
            }
            state = next.state;
            draw();
          }
        };
        const onData = (chunk: Buffer | string): void => {
          pending.push(...keysOf(typeof chunk === "string" ? chunk : chunk.toString("utf8")));
          feed();
        };
        input.setRawMode?.(true);
        input.on("data", onData);
        input.resume();
        output.write("\x1b[?25l");
        draw();
        feed();
      });
    },
  };
}
