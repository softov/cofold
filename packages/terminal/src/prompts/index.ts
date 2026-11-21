/**
 * Prompts in a frame: select, multiselect, text, confirm, a titled block of lines, and a task with a spinner.
 *
 * Inline, not full screen: a prompt draws a live block, erases it on each key
 * and leaves one collapsed answer behind, so the session stays in the
 * scrollback. Streams, environment and platform are all injected, which is how
 * the tests drive it without a terminal. Without a terminal the questions
 * refuse, and the lines still print.
 */

import { colorSupported, glyphsFor, paintFor, unicodeSupported } from "../glyphs.js";
import { marksFor } from "./marks.js";
import { createScreen, fit, PromptCancelled, visibleLength } from "./screen.js";
import type {
  PromptMachine, PromptChoice, PromptConfirmOptions, PromptGroup, PromptMultiselectOptions, Prompts, PromptsOptions, PromptSelectOptions, PromptTextOptions, PromptTone,
} from "../types/prompts.js";

export { PromptCancelled } from "./screen.js";

/** Why a question was not asked, when nobody was there to answer it. */
export const NO_TERMINAL = "Interactive input is unavailable. Run in an interactive terminal, or pass the settings on the command line.";

export function createPrompts(options: PromptsOptions): Prompts {
  const { input, output } = options;
  const env = options.env ?? process.env;
  const interactive = input.isTTY === true && output.isTTY === true;
  const unicode = options.unicode ?? unicodeSupported(env, options.platform ?? process.platform);
  const glyphs = { ...glyphsFor(unicode), ...marksFor(unicode) };
  const paint = paintFor(options.color ?? colorSupported(env, output.isTTY === true));
  const screen = createScreen({ input, output, ellipsis: glyphs.ellipsis });
  const bar = paint.dim(glyphs.bar);

  const mark = (tone: PromptTone): string => {
    switch (tone) {
      case "ok": return paint.green(glyphs.ok);
      case "fail": return paint.red(glyphs.fail);
      case "warn": return paint.yellow(glyphs.warn);
      case "info": return paint.cyan(glyphs.info);
      case "restart": return paint.yellow(glyphs.restart);
      case "plain": return "";
    }
  };
  const body = (text: string, tone: PromptTone = "plain"): string => `${bar}  ${tone === "plain" ? "" : `${mark(tone)} `}${text}`;
  const pad = (text: string, to: number): string => text + " ".repeat(Math.max(0, to - visibleLength(text)));

  const ask = <S, R>(machine: PromptMachine<S, R>): Promise<R> => {
    if (!interactive) return Promise.reject(new Error(NO_TERMINAL));
    return screen.run(machine);
  };

  /** Run a prompt, then leave its message and answer collapsed in the scrollback. */
  const asked = async <S, R>(message: string, machine: PromptMachine<S, R>, show: (answer: R) => string): Promise<R> => {
    try {
      const answer = await ask(machine);
      screen.print([`${paint.green(glyphs.done)}  ${message}`, body(paint.dim(show(answer))), bar]);
      return answer;
    }
    catch (error) {
      if (error instanceof PromptCancelled) {
        screen.print([`${paint.red(glyphs.cancelled)}  ${message}`, body(paint.dim("cancelled"))]);
      }
      throw error;
    }
  };

  const head = (message: string): string => `${paint.cyan(glyphs.active)}  ${message}`;
  const foot = (hint: string): string => `${paint.dim(glyphs.end)}  ${paint.dim(hint)}`;

  /**
   * The lines a list may take: the terminal's height less the question, the
   * foot and a line for a refusal. A block taller than the screen cannot be
   * erased by moving up over it, so every key would leave a copy behind; a
   * stream that does not know its height is drawn whole.
   */
  const room = (): number => (output.rows === undefined ? Number.POSITIVE_INFINITY : Math.max(3, output.rows - 4));

  /**
   * The rows of a list of choices, with the group headings between.
   *
   * A list longer than the room is drawn as a window that keeps the cursor in
   * it, with a line above and below saying how many choices are out of sight.
   */
  const rows = <V extends string>(
    choices: readonly PromptChoice<V>[],
    cursor: number,
    markOf: (at: number, choice: PromptChoice<V>) => string,
    numbered = false,
  ): string[] => {
    const widest = Math.max(...choices.map((one) => visibleLength(one.label)));
    const digits = String(choices.length).length;
    const number = (at: number): string => (numbered ? `${paint.dim(String(at + 1).padStart(digits))} ` : "");
    // Each line with the choice it draws; a heading or a gap draws none.
    const lines: { text: string; choice?: number }[] = [];
    let group: string | undefined;
    choices.forEach((choice, at) => {
      if (choice.group !== undefined && choice.group !== group) {
        if (group !== undefined) lines.push({ text: bar });
        lines.push({ text: body(paint.bold(choice.group)) });
      }
      group = choice.group;
      const here = at === cursor;
      const label = pad(here ? paint.cyan(choice.label) : choice.label, widest);
      const hint = choice.hint === undefined ? "" : `  ${paint.dim(choice.hint)}`;
      lines.push({ text: `${bar}  ${here ? paint.cyan(glyphs.pointer) : " "} ${markOf(at, choice)} ${number(at)}${label}${hint}`, choice: at });
    });
    const limit = room();
    if (lines.length <= limit) return lines.map((line) => line.text);
    // Two lines go to the counts, and the cursor's line sits in the middle of the rest where it can.
    const shown = Math.max(1, limit - 2);
    const at = lines.findIndex((line) => line.choice === cursor);
    const start = Math.min(Math.max(0, at - Math.floor(shown / 2)), lines.length - shown);
    const window = lines.slice(start, start + shown);
    const above = lines.slice(0, start).filter((line) => line.choice !== undefined).length;
    const below = lines.slice(start + shown).filter((line) => line.choice !== undefined).length;
    const count = (n: number, where: string): string => body(paint.dim(n === 0 ? "" : `${glyphs.ellipsis} ${n} more ${where}`));
    return [count(above, "above"), ...window.map((line) => line.text), count(below, "below")];
  };

  const move = (at: number, key: string, length: number): number => {
    if (key === "up" || key === "k") return (at + length - 1) % length;
    if (key === "down" || key === "j") return (at + 1) % length;
    return at;
  };
  const keyName = (key: { name: string; char?: string }): string => (key.name === "char" ? key.char ?? "" : key.name);

  /**
   * A digit typed at a numbered list: where the cursor goes, and the digits that
   * make the number so far. Digits typed one after another make one number while
   * that number is still a choice; one that is not starts a new number with
   * itself, and a digit that names no choice moves nothing.
   */
  const typedMove = (at: number, typed: string, digit: string, length: number): { at: number; typed: string } => {
    const longer = Number(`${typed}${digit}`);
    if (typed !== "" && longer >= 1 && longer <= length) return { at: longer - 1, typed: `${typed}${digit}` };
    const alone = Number(digit);
    if (alone >= 1 && alone <= length) return { at: alone - 1, typed: digit };
    return { at, typed: "" };
  };
  const isDigit = (key: { name: string; char?: string }): boolean => key.name === "char" && /^[0-9]$/u.test(key.char ?? "");

  return {
    interactive,
    unicode,
    intro(title) {
      screen.print([`${paint.cyan(glyphs.active)}  ${paint.bold(title)}`, bar]);
    },
    outro(text, tone = "ok") {
      screen.print([`${paint.dim(glyphs.end)}  ${tone === "plain" ? "" : `${mark(tone)} `}${text}`]);
    },
    async group<T>(title: string, run: (group: PromptGroup) => Promise<T> | T): Promise<T> {
      screen.print([`${paint.green(glyphs.done)}  ${title}`]);
      const group: PromptGroup = {
        line(tone, text) { screen.print([body(text, tone)]); },
        rows(entries) {
          const widest = Math.max(0, ...entries.map(([name]) => name.length));
          screen.print(entries.map(([name, value]) => body(`${paint.dim(pad(name, widest))}  ${value}`)));
        },
        async task(text, work) {
          if (!interactive) {
            try {
              const done = await work();
              screen.print([body(text, "ok")]);
              return done;
            }
            catch (error) {
              screen.print([body(text, "fail")]);
              throw error;
            }
          }
          let frame = 0;
          const draw = (): void => {
            const spin = paint.cyan(glyphs.spinner[frame % glyphs.spinner.length] as string);
            output.write(`\r\x1b[2K${fit(`${bar}  ${spin} ${text}`, screen.width(), glyphs.ellipsis)}`);
            frame += 1;
          };
          output.write("\x1b[?25l");
          draw();
          const timer = setInterval(draw, 80);
          timer.unref();
          try {
            const done = await work();
            clearInterval(timer);
            output.write(`\r\x1b[2K\x1b[?25h${body(text, "ok")}\n`);
            return done;
          }
          catch (error) {
            clearInterval(timer);
            output.write(`\r\x1b[2K\x1b[?25h${body(text, "fail")}\n`);
            throw error;
          }
        },
      };
      try {
        return await run(group);
      }
      finally {
        screen.print([bar]);
      }
    },

    select<V extends string>(o: PromptSelectOptions<V>): Promise<V> {
      type State = { at: number; typed: string };
      const numbered = o.numbers ?? options.numbers ?? false;
      const start = Math.max(0, o.choices.findIndex((one) => one.value === o.initial));
      return asked<State, V>(o.message, {
        init: { at: start, typed: "" },
        view: (s) => [
          head(o.message),
          ...rows(o.choices, s.at, (index) => (index === s.at ? paint.cyan(glyphs.selected) : glyphs.unselected), numbered),
          foot(numbered ? "Up and down or a number to move · Enter to choose" : "Up and down to move · Enter to choose"),
        ],
        step: (s, key) => {
          if (key.name === "enter") return { done: (o.choices[s.at] as PromptChoice<V>).value };
          if (numbered && isDigit(key)) return { state: typedMove(s.at, s.typed, key.char as string, o.choices.length) };
          return { state: { at: move(s.at, keyName(key), o.choices.length), typed: "" } };
        },
      }, (value) => o.choices.find((one) => one.value === value)?.label ?? value);
    },

    multiselect<V extends string>(o: PromptMultiselectOptions<V>): Promise<V[]> {
      type State = { at: number; on: readonly V[]; error?: string; typed?: string };
      const numbered = o.numbers ?? options.numbers ?? false;
      const state: State = { at: 0, on: o.initial ?? [] };
      return asked<State, V[]>(o.message, {
        init: state,
        view: (s) => [
          head(o.message),
          ...rows(o.choices, s.at, (_index, choice) => (s.on.includes(choice.value) ? paint.green(glyphs.checked) : glyphs.unchecked), numbered),
          ...(s.error === undefined ? [] : [body(s.error, "fail")]),
          foot(numbered ? "A number to move · Space to select · Enter to continue" : "Space to select · Enter to continue"),
        ],
        step: (s, key) => {
          const name = keyName(key);
          if (key.name === "enter") {
            if (o.required === true && s.on.length === 0) return { state: { ...s, error: "Choose at least one." } };
            // In the order the choices are listed, not the order they were ticked.
            return { done: o.choices.map((one) => one.value).filter((value) => s.on.includes(value)) };
          }
          if (numbered && isDigit(key)) {
            const moved = typedMove(s.at, s.typed ?? "", key.char as string, o.choices.length);
            return { state: { at: moved.at, on: s.on, typed: moved.typed } };
          }
          if (key.name === "space") {
            const value = (o.choices[s.at] as PromptChoice<V>).value;
            return { state: { at: s.at, on: s.on.includes(value) ? s.on.filter((one) => one !== value) : [...s.on, value] } };
          }
          return { state: { at: move(s.at, name, o.choices.length), on: s.on } };
        },
      }, (values) => (values.length === 0 ? "none" : values.map((value) => o.choices.find((one) => one.value === value)?.label ?? value).join(", ")));
    },

    text(o: PromptTextOptions): Promise<string> {
      type State = { value: string[]; at: number; error?: string };
      const initial = [...(o.initial ?? "")];
      return asked<State, string>(o.message, {
        init: { value: initial, at: initial.length },
        view: (s) => {
          const before = s.value.slice(0, s.at).join("");
          const under = s.value[s.at] ?? " ";
          const after = s.value.slice(s.at + 1).join("");
          return [
            head(o.message),
            `${bar}  ${before}${paint.inverse(under)}${after}`,
            ...(s.error === undefined ? [] : [body(s.error, "fail")]),
            foot("Enter to confirm"),
          ];
        },
        step: (s, key) => {
          switch (key.name) {
            case "enter": {
              const value = s.value.join("");
              const refused = o.validate?.(value);
              return refused === undefined ? { done: value } : { state: { ...s, error: refused } };
            }
            case "left": return { state: { value: s.value, at: Math.max(0, s.at - 1) } };
            case "right": return { state: { value: s.value, at: Math.min(s.value.length, s.at + 1) } };
            case "home": return { state: { value: s.value, at: 0 } };
            case "end": return { state: { value: s.value, at: s.value.length } };
            case "backspace":
              return s.at === 0 ? { state: s } : { state: { value: [...s.value.slice(0, s.at - 1), ...s.value.slice(s.at)], at: s.at - 1 } };
            case "delete": return { state: { value: [...s.value.slice(0, s.at), ...s.value.slice(s.at + 1)], at: s.at } };
            case "char":
            case "space":
              return { state: { value: [...s.value.slice(0, s.at), key.char as string, ...s.value.slice(s.at)], at: s.at + 1 } };
            default: return { state: s };
          }
        },
      }, (value) => (value === "" ? "(empty)" : value));
    },

    confirm(o: PromptConfirmOptions): Promise<boolean> {
      return asked<boolean, boolean>(o.message, {
        init: o.initial ?? true,
        view: (yes) => [
          head(o.message),
          body(`${yes ? paint.cyan(glyphs.selected) : glyphs.unselected} Yes   ${yes ? glyphs.unselected : paint.cyan(glyphs.selected)} No`),
          foot("Left and right to change · Enter to confirm"),
        ],
        step: (yes, key) => {
          const name = keyName(key);
          if (key.name === "enter") return { done: yes };
          if (name === "y" || name === "Y") return { done: true };
          if (name === "n" || name === "N") return { done: false };
          if (name === "left" || name === "right" || name === "h" || name === "l" || key.name === "space") return { state: !yes };
          return { state: yes };
        },
      }, (yes) => (yes ? "Yes" : "No"));
    },
  };
}
