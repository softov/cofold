/**
 * The flow, answered with keys: a first run, a second run that changes one section, and the ways out.
 */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { changesOf, configure } from "./flow.js";
import type { Seams, Settings } from "./flow.js";
import { createPrompts, NO_TERMINAL, PromptCancelled } from "@cofold/terminal";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const SPACE = " ";

function run(keys: string[], held?: Settings) {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
  let screen = "";
  output.on("data", (chunk: Buffer) => { screen += chunk.toString("utf8"); });
  for (const key of keys) input.write(key);
  const written: Settings[] = [];
  const installed: string[] = [];
  const seams: Seams = {
    read: () => held,
    write: (settings) => { written.push(settings); },
    install: (name) => { installed.push(name); return Promise.resolve(); },
    detect: () => Promise.resolve([{ id: "claude", version: "2.1.302" }]),
    environment: { node: "24.0.0", configDir: "/cfg" },
  };
  const ui = createPrompts({ input, output, env: {}, platform: "linux", color: false });
  return { result: configure(ui, seams), written, installed, text: () => screen.replace(/\x1b\[[0-9;?]*[A-Za-z]|\r/gu, "") };
}

const held: Settings = { plugins: ["claude", "web"], agents: [], host: "127.0.0.1", port: 9187, access: "token" };

describe("a first run", () => {
  // Pi, then ACP ticked; ACP takes the detected Claude Code CLI; the network; the default port; Team; the default admin; apply.
  const keys = [DOWN, SPACE, DOWN, DOWN, SPACE, ENTER, SPACE, ENTER, DOWN, ENTER, ENTER, DOWN, ENTER, ENTER, ENTER];

  it("asks for each section, reviews, writes once, and installs only what is new", async () => {
    const { result, written, installed, text } = run(keys);
    const done = await result;
    expect(done?.settings).toEqual({
      plugins: ["claude", "pi", "acp", "web"], agents: ["claude"], host: "0.0.0.0", port: 9187, access: "users", admin: "admin",
    });
    expect(written).toHaveLength(1);
    expect(installed).toEqual(["@demo/agent-claude", "@demo/agent-pi", "@demo/agent-acp", "@demo/web"]);
    const out = text();
    expect(out).toContain("Agent providers");
    expect(out).toContain("Detected executables");
    expect(out).toContain("Claude Code CLI  2.1.302");
    expect(out).toMatch(/Plugins\s+Claude Code, Pi, ACP, Web UI/u);
    expect(out).toContain("⚠ HTTP is not encrypted");
    expect(out).toContain("└  ✓ Configuration complete!");
  });

  it("writes nothing when the review is refused", async () => {
    const refused = [ENTER, ENTER, ENTER, ENTER, "n"];
    const { result, written, installed, text } = run(refused);
    expect(await result).toBeUndefined();
    expect(written).toEqual([]);
    expect(installed).toEqual([]);
    expect(text()).toContain("Not applied. Nothing was written.");
  });

  it("hides the agents it did not find behind Show more", async () => {
    // ACP ticked; in the agent list the cursor goes to "Show more...", ticks it; the full list follows and Goose is ticked.
    const toMore = [DOWN, DOWN, DOWN, SPACE, ENTER, ...Array<string>(5).fill(DOWN), SPACE, ENTER, ...Array<string>(5).fill(DOWN), SPACE, ENTER, ENTER, ENTER, ENTER, ENTER];
    const { result, text } = run(toMore);
    const done = await result;
    expect(text()).toContain("Show more...");
    expect(done?.settings.agents).toEqual(["goose"]);
  });
});

describe("a second run", () => {
  it("asks which section, and asks only that section's questions", async () => {
    // Server & networking, the network, the same port, apply.
    const { result, written, installed, text } = run([DOWN, ENTER, DOWN, ENTER, ENTER, ENTER], held);
    const done = await result;
    expect(done?.changes).toEqual([["Listening", "127.0.0.1:9187 → 0.0.0.0:9187"]]);
    expect(done?.settings.plugins).toEqual(["claude", "web"]);
    expect(written).toHaveLength(1);
    expect(installed).toEqual([]);
    const out = text();
    expect(out).toContain("Existing configuration");
    expect(out).not.toContain("Access control");
    expect(out).not.toContain("What would you like to enable?");
  });

  it("says nothing changed, and writes nothing, when the answers are the ones it held", async () => {
    const { result, written, text } = run([DOWN, ENTER, ENTER, ENTER], held);
    expect((await result)?.changes).toEqual([]);
    expect(written).toEqual([]);
    expect(text()).toContain("Nothing changed.");
  });
});

describe("the way out", () => {
  it("refuses before printing anything when nobody is there to answer", async () => {
    const input = Object.assign(new PassThrough(), { isTTY: false });
    const output = Object.assign(new PassThrough(), { isTTY: false });
    let screen = "";
    output.on("data", (chunk: Buffer) => { screen += chunk.toString("utf8"); });
    const seams = { read: () => undefined, write: () => undefined, install: () => Promise.resolve(), detect: () => Promise.resolve([]), environment: { node: "24", configDir: "/c" } };
    await expect(configure(createPrompts({ input, output, env: {}, platform: "linux" }), seams)).rejects.toThrow(NO_TERMINAL);
    expect(screen).toBe("");
  });

  it("cancels at any question without writing", async () => {
    const { result, written } = run([ENTER, "\x1b"]);
    await expect(result).rejects.toBeInstanceOf(PromptCancelled);
    expect(written).toEqual([]);
  });
});

describe("changesOf", () => {
  it("names old and new for what differs and skips what does not", () => {
    expect(changesOf(held, { ...held, port: 9000, plugins: ["claude"] })).toEqual([
      ["Plugins", "Claude Code, Web UI → Claude Code"],
      ["Listening", "127.0.0.1:9187 → 127.0.0.1:9000"],
    ]);
  });
});
