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

  /** The rows of a list of choices, with the group headings between. */
  const rows = <V extends string>(
    choices: readonly PromptChoice<V>[],
    cursor: number,
    markOf: (at: number, choice: PromptChoice<V>) => string,
  ): string[] => {
    const widest = Math.max(...choices.map((one) => visibleLength(one.label)));
    const lines: string[] = [];
    let group: string | undefined;
    choices.forEach((choice, at) => {
      if (choice.group !== undefined && choice.group !== group) {
        if (group !== undefined) lines.push(bar);
        lines.push(body(paint.bold(choice.group)));
      }
      group = choice.group;
      const here = at === cursor;
      const label = pad(here ? paint.cyan(choice.label) : choice.label, widest);
      const hint = choice.hint === undefined ? "" : `  ${paint.dim(choice.hint)}`;
      lines.push(`${bar}  ${here ? paint.cyan(glyphs.pointer) : " "} ${markOf(at, choice)} ${label}${hint}`);
    });
    return lines;
  };

  const move = (at: number, key: string, length: number): number => {
    if (key === "up" || key === "k") return (at + length - 1) % length;
    if (key === "down" || key === "j") return (at + 1) % length;
    return at;
  };
  const keyName = (key: { name: string; char?: string }): string => (key.name === "char" ? key.char ?? "" : key.name);

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
      const start = Math.max(0, o.choices.findIndex((one) => one.value === o.initial));
      return asked(o.message, {
        init: start,
        view: (at) => [
          head(o.message),
          ...rows(o.choices, at, (index) => (index === at ? paint.cyan(glyphs.selected) : glyphs.unselected)),
          foot("Up and down to move · Enter to choose"),
        ],
        step: (at, key) => {
          if (key.name === "enter") return { done: (o.choices[at] as PromptChoice<V>).value };
          return { state: move(at, keyName(key), o.choices.length) };
        },
      }, (value) => o.choices.find((one) => one.value === value)?.label ?? value);
    },

    multiselect<V extends string>(o: PromptMultiselectOptions<V>): Promise<V[]> {
      type State = { at: number; on: readonly V[]; error?: string };
      const state: State = { at: 0, on: o.initial ?? [] };
      return asked<State, V[]>(o.message, {
        init: state,
        view: (s) => [
          head(o.message),
          ...rows(o.choices, s.at, (_index, choice) => (s.on.includes(choice.value) ? paint.green(glyphs.checked) : glyphs.unchecked)),
          ...(s.error === undefined ? [] : [body(s.error, "fail")]),
          foot("Space to select · Enter to continue"),
        ],
        step: (s, key) => {
          const name = keyName(key);
          if (key.name === "enter") {
            if (o.required === true && s.on.length === 0) return { state: { ...s, error: "Choose at least one." } };
            // In the order the choices are listed, not the order they were ticked.
            return { done: o.choices.map((one) => one.value).filter((value) => s.on.includes(value)) };
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
