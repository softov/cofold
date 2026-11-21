/** The marks a terminal program says things with, in one of two sets: unicode, or one-width ASCII. */
export interface Glyphs {
  ok: string;
  fail: string;
  warn: string;
  info: string;
  restart: string;
  arrow: string;
  ellipsis: string;
  spinner: readonly string[];
}

/** The text styles. Each returns its argument unchanged when colour is off. */
export interface Paint {
  bold(text: string): string;
  dim(text: string): string;
  green(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  inverse(text: string): string;
}
