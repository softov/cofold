import type { TerminalKey } from "./types/keys.js";

const SEQUENCES: ReadonlyMap<string, string> = new Map([
  ["\x1b[A", "up"], ["\x1bOA", "up"], ["\x1b[B", "down"], ["\x1bOB", "down"],
  ["\x1b[C", "right"], ["\x1bOC", "right"], ["\x1b[D", "left"], ["\x1bOD", "left"],
  ["\x1b[H", "home"], ["\x1b[1~", "home"], ["\x1b[F", "end"], ["\x1b[4~", "end"],
  ["\x1b[3~", "delete"],
]);

/**
 * The keys in one chunk of input.
 *
 * A terminal delivers several keys in one chunk when they are typed fast or
 * pasted, so a chunk is walked, not matched. A lone escape is the escape key;
 * an escape sequence this does not know is dropped whole, because its tail
 * would otherwise be typed into an answer.
 */
export function keysOf(chunk: string): TerminalKey[] {
  const keys: TerminalKey[] = [];
  let at = 0;
  while (at < chunk.length) {
    const rest = chunk.slice(at);
    if (rest.startsWith("\x1b")) {
      const known = [...SEQUENCES.keys()].find((sequence) => rest.startsWith(sequence));
      if (known !== undefined) {
        keys.push({ name: SEQUENCES.get(known) as string });
        at += known.length;
        continue;
      }
      const csi = /^\x1b\[[0-9;?]*[ -/]*[@-~]/u.exec(rest);
      if (csi !== null) {
        at += csi[0].length;
        continue;
      }
      keys.push({ name: "escape" });
      at += 1;
      continue;
    }
    const char = [...rest][0] as string;
    at += char.length;
    if (char === "\r" || char === "\n") keys.push({ name: "enter" });
    else if (char === " ") keys.push({ name: "space", char });
    else if (char === "\x03") keys.push({ name: "ctrl-c" });
    else if (char === "\x04") keys.push({ name: "ctrl-d" });
    else if (char === "\x7f" || char === "\b") keys.push({ name: "backspace" });
    else if (char >= " ") keys.push({ name: "char", char });
  }
  return keys;
}
