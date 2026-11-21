#!/usr/bin/env node
/**
 * wizard - the prompts in a flow, as a program.
 *
 * `wizard configure` is the shape of `ahpd configure` on stand-in data: a
 * first run asks everything, a second run asks which section to change, and
 * both end in a review of what changes before anything is written. It writes a
 * JSON file and "installs" by waiting, so it can be run anywhere.
 *
 *   node dist/wizard/cli.js configure --config-file /tmp/wizard.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRegistry, output } from "@cofold/commands";
import { createPrompts, Program, PromptCancelled, runEntry } from "@cofold/terminal";
import { configure } from "./flow.js";
import type { Settings } from "./flow.js";

export const registry = createRegistry();

registry.action({
  id: "wizard.configure",
  summary: "Ask for the settings, review them, and write them",
  effect: "change",
  input: {
    configFile: {
      type: "string",
      description: "Where the settings are kept",
      default: "wizard-config.json",
      cli: { flag: "--config-file", value: "FILE" },
    },
    delay: {
      type: "integer",
      description: "Milliseconds each fake install takes",
      default: 400,
      cli: { flag: "--delay", value: "MS" },
    },
  },
  surfaces: { cli: { pattern: ["configure"] } },
  run: async (context) => {
    const file = resolve(context.value<string>("configFile"));
    const delay = context.value<number>("delay");
    const ui = createPrompts({ input: process.stdin, output: process.stdout });
    try {
      const done = await configure(ui, {
        read: () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Settings : undefined),
        write: (settings) => {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
        },
        install: (name) => new Promise((done) => { setTimeout(done, delay + name.length); }),
        detect: () => Promise.resolve([{ id: "claude", version: "2.1.302" }]),
        environment: { node: process.versions.node, configDir: dirname(file) },
      });
      return output({ written: done !== undefined, file }, "");
    }
    catch (error) {
      if (error instanceof PromptCancelled) {
        ui.outro("Cancelled. Nothing was written.", "warn");
        process.exitCode = 130;
        return output({ written: false, file }, "");
      }
      throw error;
    }
  },
});

export const program = new Program({
  name: "wizard",
  version: "0.1.0",
  description: "Prompts in a frame, on stand-in data.",
  registry,
});

if (process.argv[1]?.endsWith("cli.js") === true) {
  await runEntry(program, process.argv.slice(2));
}
