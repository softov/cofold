/**
 * What the prompts have to be true for, driven through fake streams: keys in, the screen out.
 */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPrompts, NO_TERMINAL, PromptCancelled } from "./index.js";
import type { PromptsOptions } from "../types/prompts.js";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

/** A terminal with the keys already typed. What it printed is `screen()`, without colour or cursor codes. */
function terminal(keys: string[], extra: Partial<PromptsOptions> & { detectColor?: boolean } = {}, tty = true, rows?: number) {
  const { detectColor = false, ...rest } = extra;
  const input = Object.assign(new PassThrough(), { isTTY: tty, setRawMode: () => undefined });
  const output = Object.assign(new PassThrough(), { isTTY: tty, columns: 60, ...(rows === undefined ? {} : { rows }) });
  const written: string[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  for (const key of keys) input.write(key);
  const prompts = createPrompts({ input, output, env: {}, platform: "linux", ...(detectColor ? {} : { color: false }), ...rest });
  /** The final screen: erase sequences applied, so only what stayed in the scrollback is left. */
  const screen = (): string => {
    let text = "";
    for (const part of written) {
      const up = /^\x1b\[(\d+)A\r\x1b\[J$/u.exec(part);
      if (up === null) text += part.replace(/\x1b\[\?25[lh]/gu, "");
      else {
        const lines = text.split("\n");
        lines.splice(Math.max(0, lines.length - 1 - Number(up[1])), Number(up[1]));
        text = lines.join("\n");
      }
    }
    return text;
  };
  return { prompts, screen, written };
}

describe("select", () => {
  it("answers the choice under the cursor and leaves one collapsed line", async () => {
    const { prompts, screen } = terminal([`${DOWN}${ENTER}`]);
    const answer = await prompts.select({
      message: "Who can connect?",
      choices: [{ value: "me", label: "This machine only" }, { value: "lan", label: "Local network" }],
    });
    expect(answer).toBe("lan");
    expect(screen()).toBe("◇  Who can connect?\n│  Local network\n│\n");
  });

  it("starts on the initial value and wraps round", async () => {
    const { prompts } = terminal([`${UP}${ENTER}`]);
    const answer = await prompts.select({
      message: "m", initial: "b",
      choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }],
    });
    expect(answer).toBe("a");
  });
});

describe("a list taller than the terminal", () => {
  const ten = Array.from({ length: 10 }, (_, at) => ({ value: String(at + 1), label: `Item ${String(at + 1)}` }));
  /** Each live frame drawn, as its lines. */
  const frames = (written: string[]): string[][] => written
    .filter((part) => part.includes("◆  m"))
    .map((part) => part.replace(/\n$/u, "").split("\n"));

  it("draws a window that keeps the cursor in it, and says how many are out of sight", async () => {
    const { prompts, screen, written } = terminal([`${DOWN.repeat(5)}${ENTER}`], {}, true, 8);
    const answer = await prompts.select({ message: "m", choices: ten });
    expect(answer).toBe("6");
    const drawn = frames(written);
    expect(drawn[0]).toContain("│  … 8 more below");
    expect(drawn[0]?.some((line) => line.includes("Item 3"))).toBe(false);
    // On the sixth item, both sides have some out of sight.
    expect(drawn.at(-1)?.some((line) => line.includes("more above"))).toBe(true);
    expect(drawn.at(-1)?.some((line) => line.includes("❯") && line.includes("Item 6"))).toBe(true);
    // No frame is taller than the terminal, so each erase covers the frame before it.
    for (const frame of drawn) expect(frame.length).toBeLessThanOrEqual(8);
    expect(screen()).toBe("◇  m\n│  Item 6\n│\n");
  });

  it("windows a multiselect too, and keeps its ticks out of sight", async () => {
    const { prompts, written } = terminal([` ${UP} ${ENTER}`], {}, true, 8);
    const answer = await prompts.multiselect({ message: "m", choices: ten });
    // Up from the first wraps to the last, which the window then shows.
    expect(answer).toEqual(["1", "10"]);
    expect(frames(written).at(-1)?.some((line) => line.includes("more above"))).toBe(true);
  });

  it("draws the list whole when the stream does not know its height", async () => {
    const { prompts, written } = terminal([ENTER]);
    await prompts.select({ message: "m", choices: ten });
    expect(frames(written)[0]?.filter((line) => line.includes("Item"))).toHaveLength(10);
  });
});

describe("multiselect", () => {
  const choices = [
    { value: "claude", label: "Claude Code", hint: "Native SDK", group: "Agent providers" },
    { value: "pi", label: "Pi", group: "Agent providers" },
    { value: "web", label: "Web UI", group: "Interfaces" },
  ] as const;

  it("answers in the order of the list, not the order ticked, and starts from the initial ticks", async () => {
    const { prompts } = terminal([`${DOWN}${DOWN} ${UP} ${ENTER}`]);
    expect(await prompts.multiselect({ message: "Enable?", choices, initial: ["claude"] })).toEqual(["claude", "pi", "web"]);
  });

  it("draws the group headings and the cursor", async () => {
    const { prompts, written } = terminal([`${ENTER}`]);
    await prompts.multiselect({ message: "Enable?", choices });
    const first = written.find((part) => part.includes("Enable?")) as string;
    expect(first).toContain("│  Agent providers");
    expect(first).toContain("│  ❯ ◯ Claude Code  Native SDK");
    expect(first).toContain("│  Interfaces");
  });

  it("refuses an empty answer when one is required, then takes the next", async () => {
    const { prompts, written } = terminal([`${ENTER} ${ENTER}`]);
    expect(await prompts.multiselect({ message: "Enable?", choices, required: true })).toEqual(["claude"]);
    expect(written.join("")).toContain("Choose at least one.");
  });
});

describe("text", () => {
  it("edits at the cursor", async () => {
    const { prompts } = terminal([`ac\x1b[Db${ENTER}`]);
    expect(await prompts.text({ message: "Id" })).toBe("abc");
  });

  it("keeps the prompt when validate refuses, and shows why", async () => {
    const { prompts, written } = terminal(["x", ENTER, "\x7f", "9", ENTER]);
    const value = await prompts.text({ message: "Port", validate: (v) => (/^\d+$/u.test(v) ? undefined : "A number, please.") });
    expect(value).toBe("9");
    expect(written.join("")).toContain("✗ A number, please.");
  });
});

describe("confirm", () => {
  it("takes y and n without Enter", async () => {
    expect(await terminal(["n"]).prompts.confirm({ message: "m" })).toBe(false);
    expect(await terminal(["y"]).prompts.confirm({ message: "m", initial: false })).toBe(true);
  });

  it("answers what Enter keeps", async () => {
    expect(await terminal([ENTER]).prompts.confirm({ message: "m", initial: false })).toBe(false);
  });
});

describe("cancel", () => {
  it("rejects with PromptCancelled on escape and leaves the line saying so", async () => {
    const { prompts, screen } = terminal([ESC]);
    await expect(prompts.select({ message: "m", choices: [{ value: "a", label: "A" }] })).rejects.toBeInstanceOf(PromptCancelled);
    expect(screen()).toBe("■  m\n│  cancelled\n");
  });

  it("rejects on ctrl-c", async () => {
    await expect(terminal(["\x03"]).prompts.confirm({ message: "m" })).rejects.toBeInstanceOf(PromptCancelled);
  });
});

describe("without a terminal", () => {
  it("refuses a question and says why", async () => {
    const { prompts } = terminal([ENTER], {}, false);
    expect(prompts.interactive).toBe(false);
    await expect(prompts.confirm({ message: "m" })).rejects.toThrow(NO_TERMINAL);
  });

  it("still prints the lines", async () => {
    const { prompts, screen } = terminal([], {}, false);
    await prompts.group("Environment", (group) => { group.line("ok", "Node.js 24"); });
    expect(screen()).toBe("◇  Environment\n│  ✓ Node.js 24\n│\n");
  });
});

describe("the frame", () => {
  it("falls back to ascii where unicode cannot be drawn", async () => {
    const { prompts, screen } = terminal([], { env: { TERM: "linux" } });
    expect(prompts.unicode).toBe(false);
    await prompts.group("Env", (group) => { group.line("ok", "Node"); group.line("warn", "Old"); });
    expect(screen()).toBe("o  Env\n|  + Node\n|  ! Old\n|\n");
  });

  it("writes no colour code with NO_COLOR, and some without it", async () => {
    const plain = terminal([], { detectColor: true, env: { NO_COLOR: "1" } });
    await plain.prompts.group("T", (group) => { group.line("ok", "x"); });
    expect(plain.written.join("")).not.toContain("\x1b[");
    const colored = terminal([], { detectColor: true, env: {} });
    await colored.prompts.group("T", (group) => { group.line("ok", "x"); });
    expect(colored.written.join("")).toContain("\x1b[32m");
  });

  it("aligns rows", async () => {
    const { prompts, screen } = terminal([]);
    await prompts.group("Server", (group) => { group.rows([["Host", "0.0.0.0"], ["Port", "9187"], ["Listening", "yes"]]); });
    expect(screen()).toContain("│  Host       0.0.0.0\n│  Port       9187\n│  Listening  yes");
  });

  it("cuts a live line to the width so the erase count stays right", async () => {
    const { prompts, written } = terminal([ENTER], { });
    await prompts.select({ message: "m", choices: [{ value: "a", label: "x".repeat(200) }] });
    const live = written.find((part) => part.includes("xxx")) as string;
    expect(live.split("\n").every((line) => [...line.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, "")].length <= 62)).toBe(true);
  });

  it("shows a task as a line that ends in a mark, and as a fail when the work throws", async () => {
    const { prompts, screen } = terminal([], {}, false);
    await prompts.group("Installing", async (group) => {
      await group.task("@ahpd/web", () => Promise.resolve());
      await expect(group.task("@ahpd/bad", () => Promise.reject(new Error("E404")))).rejects.toThrow("E404");
    });
    expect(screen()).toBe("◇  Installing\n│  ✓ @ahpd/web\n│  ✗ @ahpd/bad\n│\n");
  });

  it("restores the terminal after a prompt: raw mode off, cursor shown", async () => {
    const modes: boolean[] = [];
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (on: boolean) => { modes.push(on); } });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 60 });
    const written: string[] = [];
    output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
    input.write(ENTER);
    await createPrompts({ input, output, env: {}, platform: "linux" }).confirm({ message: "m" });
    expect(modes).toEqual([true, false]);
    expect(written.join("")).toContain("\x1b[?25h");
  });
});
