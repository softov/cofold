import type { Glyphs, Paint } from "./types/glyphs.js";

type Env = Readonly<Record<string, string | undefined>>;

const UNICODE: Glyphs = {
  ok: "✓", fail: "✗", warn: "⚠", info: "ℹ", restart: "↻", arrow: "→", ellipsis: "…",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

/** Every mark one character wide, for a terminal that cannot draw the others. */
const ASCII: Glyphs = {
  ok: "+", fail: "x", warn: "!", info: "i", restart: "~", arrow: "->", ellipsis: "...",
  spinner: ["-", "\\", "|", "/"],
};

const LOCALE = /utf-?8/iu;

/**
 * Whether the terminal draws unicode.
 *
 * The Linux console and `TERM=dumb` cannot. A locale that names a charset
 * other than UTF-8 cannot. Windows can in Windows Terminal and VS Code, which
 * say so in their environment, and not in the legacy console host.
 */
export function unicodeSupported(env: Env, platform: NodeJS.Platform): boolean {
  if (env["TERM"] === "linux" || env["TERM"] === "dumb") return false;
  if (platform === "win32") {
    return env["WT_SESSION"] !== undefined || env["TERM_PROGRAM"] === "vscode" || env["ConEmuTask"] !== undefined;
  }
  const locale = env["LC_ALL"] ?? env["LC_CTYPE"] ?? env["LANG"];
  return locale === undefined || locale === "" || LOCALE.test(locale);
}

/** Colour, unless `NO_COLOR`, a dumb terminal or a pipe says otherwise; `FORCE_COLOR` turns it on over the pipe. */
export function colorSupported(env: Env, tty: boolean): boolean {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "" && env["FORCE_COLOR"] !== "0") return true;
  if (env["TERM"] === "dumb") return false;
  return tty;
}

export function glyphsFor(unicode: boolean): Glyphs {
  return unicode ? UNICODE : ASCII;
}

const wrap = (open: number, close: number) => (text: string): string => `\x1b[${open}m${text}\x1b[${close}m`;

export function paintFor(color: boolean): Paint {
  if (!color) {
    const plain = (text: string): string => text;
    return { bold: plain, dim: plain, green: plain, red: plain, yellow: plain, cyan: plain, inverse: plain };
  }
  return {
    bold: wrap(1, 22), dim: wrap(2, 22), green: wrap(32, 39), red: wrap(31, 39),
    yellow: wrap(33, 39), cyan: wrap(36, 39), inverse: wrap(7, 27),
  };
}
