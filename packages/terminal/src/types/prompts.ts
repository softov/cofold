import type { Readable, Writable } from "node:stream";
import type { TerminalKey } from "./keys.js";

/** The input stream a person types on. `setRawMode` exists only on a real terminal. */
export type PromptInput = Readable & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown };

/** The output stream the prompts draw on. `columns` is the width, when the stream knows it. */
export type PromptOutput = Writable & { isTTY?: boolean; columns?: number };

/** What `createPrompts` is given. Every field but the streams has a default read from the environment. */
export interface PromptsOptions {
  input: PromptInput;
  output: PromptOutput;
  /** The environment the colour and glyph choices are read from. Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The platform, which decides the glyph set on Windows. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Force the glyph set. Absent, it is read from the environment. */
  unicode?: boolean;
  /** Force colour on or off. Absent, `NO_COLOR`, `TERM=dumb` and a pipe turn it off. */
  color?: boolean;
}

/** The marks that draw the frame of a prompt, in one of two sets. */
export interface PromptMarks {
  bar: string;
  active: string;
  done: string;
  end: string;
  cancelled: string;
  checked: string;
  unchecked: string;
  selected: string;
  unselected: string;
  pointer: string;
}

/** One choice in a list. */
export interface PromptChoice<V extends string = string> {
  value: V;
  label: string;
  /** What is said beside the label, dimmed. */
  hint?: string;
  /** The heading it is listed under. Choices with the same heading must be adjacent. */
  group?: string;
}

export interface PromptSelectOptions<V extends string> {
  message: string;
  choices: readonly PromptChoice<V>[];
  initial?: V;
}

export interface PromptMultiselectOptions<V extends string> {
  message: string;
  choices: readonly PromptChoice<V>[];
  /** The values that start ticked. */
  initial?: readonly V[];
  /** Refuse an empty answer. */
  required?: boolean;
}

export interface PromptTextOptions {
  message: string;
  initial?: string;
  /** Answer an error to refuse the value; it is shown and the prompt stays. */
  validate?: (value: string) => string | undefined;
}

export interface PromptConfirmOptions {
  message: string;
  initial?: boolean;
}

/** One mark in front of a line: what the line reports. */
export type PromptTone = "ok" | "fail" | "warn" | "info" | "restart" | "plain";

/** The open block a `group` body writes into. */
export interface PromptGroup {
  line(tone: PromptTone, text: string): void;
  /** Aligned `name  value` rows. */
  rows(rows: readonly (readonly [string, string])[]): void;
  /** One line with a spinner while `work` runs, then the line it ended as. A throw is a `fail` line and is rethrown. */
  task<T>(text: string, work: () => Promise<T>): Promise<T>;
}

/** The prompts one terminal gets. */
export interface Prompts {
  /** Whether a person is on the other end: both streams are a terminal. */
  readonly interactive: boolean;
  /** Whether the frame is drawn with unicode marks. */
  readonly unicode: boolean;
  intro(title: string): void;
  outro(text: string, tone?: PromptTone): void;
  /** A titled block of lines, closed with a gap. */
  group<T>(title: string, body: (group: PromptGroup) => Promise<T> | T): Promise<T>;
  select<V extends string>(options: PromptSelectOptions<V>): Promise<V>;
  multiselect<V extends string>(options: PromptMultiselectOptions<V>): Promise<V[]>;
  text(options: PromptTextOptions): Promise<string>;
  confirm(options: PromptConfirmOptions): Promise<boolean>;
}

/** What a prompt is: how it looks for a state, and what a key does to it. */
export interface PromptMachine<S, R> {
  init: S;
  /** The lines of the live block, styled, without newlines. */
  view(state: S): string[];
  /** The state after a key, or the answer when the key finished it. */
  step(state: S, key: TerminalKey): { state: S } | { done: R };
}

/** The terminal a screen draws on: one live block at a time, erased and redrawn on each key. */
export interface PromptScreen {
  /** Write finished lines above any live block. */
  print(lines: readonly string[]): void;
  /** Run one prompt to its answer. Throws `PromptCancelled`, after erasing its block. */
  run<S, R>(machine: PromptMachine<S, R>): Promise<R>;
  /** The width lines are cut to. */
  width(): number;
}

export interface PromptScreenOptions {
  input: PromptInput;
  output: PromptOutput;
  ellipsis: string;
}
