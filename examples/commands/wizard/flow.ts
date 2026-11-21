/**
 * The configure flow, written against the prompts and four seams.
 *
 * The flow decides what is asked and in what order; the seams (`read`,
 * `write`, `install`, `detect`) are everything that touches the machine, so a
 * test answers them and a host supplies its own.
 */

import { AGENTS, HEADINGS, PLUGINS, SHOWN } from "./catalogue.js";
import type { Agent } from "./catalogue.js";
import { NO_TERMINAL } from "@cofold/terminal";
import type { Prompts } from "@cofold/terminal";

export interface Settings {
  plugins: string[];
  /** The ACP agents taken, when `acp` is on. */
  agents: string[];
  host: string;
  port: number;
  access: "token" | "users";
  admin?: string;
}

export interface Detected {
  id: string;
  version: string;
}

export interface Seams {
  /** The settings now, or nothing on a first run. */
  read(): Settings | undefined;
  write(settings: Settings): void;
  install(packageName: string): Promise<void>;
  /** The agent executables on PATH. */
  detect(): Promise<Detected[]>;
  /** What the Environment block reports. */
  environment: { node: string; configDir: string };
}

export interface Result {
  settings: Settings;
  /** What the run changed, as `name`, `old → new` rows. Empty when it changed nothing. */
  changes: [string, string][];
  installed: string[];
}

type Section = "plugins" | "server" | "access" | "review" | "full";

const FIRST: Settings = { plugins: PLUGINS.filter((one) => one.first === true).map((one) => one.id), agents: [], host: "127.0.0.1", port: 9187, access: "token" };

const nameOf = (id: string): string => PLUGINS.find((one) => one.id === id)?.title ?? id;
const list = (values: readonly string[], name: (id: string) => string = (id) => id): string => (values.length === 0 ? "none" : values.map(name).join(", "));

/** What differs between two settings, one row each. */
export function changesOf(before: Settings | undefined, after: Settings): [string, string][] {
  const rows: [string, string][] = [];
  const row = (name: string, was: string | undefined, now: string): void => {
    if (was === now) return;
    rows.push([name, was === undefined ? now : `${was} → ${now}`]);
  };
  row("Plugins", before === undefined ? undefined : list(before.plugins, nameOf), list(after.plugins, nameOf));
  if (after.plugins.includes("acp") || before?.agents.length) {
    row("ACP agents", before === undefined ? undefined : list(before.agents), list(after.agents));
  }
  row("Listening", before === undefined ? undefined : `${before.host}:${String(before.port)}`, `${after.host}:${String(after.port)}`);
  row("Access", before?.access, after.access);
  if (after.access === "users" || before?.admin !== undefined) row("Administrator", before?.admin, after.admin ?? "none");
  return rows;
}

export async function configure(ui: Prompts, seams: Seams): Promise<Result | undefined> {
  // Before the first line, so a script that pipes into it is refused with nothing printed.
  if (!ui.interactive) throw new Error(NO_TERMINAL);
  const before = seams.read();
  let next: Settings = before === undefined ? { ...FIRST } : { ...before, plugins: [...before.plugins], agents: [...before.agents] };

  ui.intro(before === undefined ? "demo · Agent Host" : "demo · Configuration");
  await ui.group("Environment", (group) => {
    group.line("ok", `Node.js ${seams.environment.node}`);
    group.line("ok", `Configuration directory ${seams.environment.configDir}`);
  });

  let sections: Section[] = ["full"];
  if (before !== undefined) {
    await ui.group("Existing configuration", (group) => {
      group.rows([
        ["Plugins", `${String(before.plugins.length)} enabled`],
        ["Agents", list(before.plugins.filter((id) => PLUGINS.find((one) => one.id === id)?.category === "agent"), nameOf)],
        ["Listening", `${before.host}:${String(before.port)}`],
        ["Access", before.access === "users" ? "Users" : "Token"],
      ]);
    });
    const chosen = await ui.select<Section>({
      message: "What would you like to configure?",
      choices: [
        { value: "plugins", label: "Plugins & integrations" },
        { value: "server", label: "Server & networking" },
        { value: "access", label: "Access" },
        { value: "full", label: "Run full setup" },
      ],
    });
    sections = [chosen];
  }
  const wants = (section: Section): boolean => sections.includes("full") || sections.includes(section);

  if (wants("plugins")) {
    next.plugins = await ui.multiselect({
      message: "What would you like to enable?",
      choices: PLUGINS.map((one) => ({ value: one.id, label: one.title, hint: one.hint, group: HEADINGS[one.category] })),
      initial: next.plugins,
    });
    // Each selected plugin that has questions of its own asks them here, and only then.
    if (next.plugins.includes("acp")) next.agents = await askAgents(ui, seams, next.agents);
    else next.agents = [];
    await ui.group("Configuring selected plugins", (group) => {
      for (const id of next.plugins) {
        if (id !== "acp") group.line("ok", `${nameOf(id).padEnd(12)} No additional setup`);
      }
      if (next.plugins.includes("acp")) group.line("ok", `${"ACP".padEnd(12)} ${list(next.agents)}`);
    });
  }

  if (wants("server")) {
    const scope = await ui.select<"local" | "lan">({
      message: "Where will clients connect from?",
      choices: [
        { value: "local", label: "This machine only", hint: "127.0.0.1" },
        { value: "lan", label: "Local network", hint: "0.0.0.0" },
      ],
      initial: next.host === "127.0.0.1" ? "local" : "lan",
    });
    next.host = scope === "local" ? "127.0.0.1" : "0.0.0.0";
    const port = await ui.text({
      message: "Port",
      initial: String(next.port),
      validate: (value) => (/^\d+$/u.test(value) && Number(value) <= 65535 ? undefined : "A port is a number from 0 to 65535."),
    });
    next.port = Number(port);
  }

  if (wants("access")) {
    next.access = await ui.select<"token" | "users">({
      message: "Access control",
      choices: [
        { value: "token", label: "Personal", hint: "One connection token" },
        { value: "users", label: "Team", hint: "Users, roles and policies" },
      ],
      initial: next.access,
    });
    if (next.access === "users") {
      next.admin = await ui.text({
        message: "Administrator id",
        initial: next.admin ?? "admin",
        validate: (value) => (value.trim() === "" || value.startsWith("-") ? "An id such as alice." : undefined),
      });
    }
    else delete next.admin;
  }

  const changes = changesOf(before, next);
  if (before !== undefined && changes.length === 0) {
    ui.outro("Nothing changed.", "plain");
    return { settings: next, changes, installed: [] };
  }
  await ui.group("Review configuration", (group) => { group.rows(changes); });
  if (!await ui.confirm({ message: "Apply configuration?", initial: true })) {
    ui.outro("Not applied. Nothing was written.", "warn");
    return undefined;
  }

  seams.write(next);
  const missing = next.plugins.filter((id) => before === undefined || !before.plugins.includes(id));
  const installed: string[] = [];
  if (missing.length > 0) {
    await ui.group("Installing plugins", async (group) => {
      for (const id of missing) {
        const name = PLUGINS.find((one) => one.id === id)?.package ?? id;
        await group.task(name, () => seams.install(name));
        installed.push(name);
      }
    });
  }
  await ui.group("Security", (group) => {
    group.line("ok", next.access === "users" ? `Administrator ${next.admin ?? ""} created` : "Connection token kept in the token file");
    if (next.host !== "127.0.0.1") group.line("warn", "HTTP is not encrypted. Use TLS for public access.");
  });
  ui.outro("Configuration complete!");
  return { settings: next, changes, installed };
}

/** The ACP step: what is on PATH, a few others, and the rest on request. */
async function askAgents(ui: Prompts, seams: Seams, taken: readonly string[]): Promise<string[]> {
  const found = await seams.detect();
  await ui.group("Configuring ACP", (group) => {
    group.line("plain", "Detected executables");
    if (found.length === 0) group.line("info", "None found on PATH");
    for (const one of found) group.line("ok", `${AGENTS.find((agent) => agent.id === one.id)?.name ?? one.id}  ${one.version}`);
  });
  const others = AGENTS.filter((agent) => !found.some((one) => one.id === agent.id));
  const MORE = "__more";
  const offer = (all: readonly Agent[], more: boolean) => [
    ...found.map((one) => ({ value: one.id, label: AGENTS.find((agent) => agent.id === one.id)?.name ?? one.id, hint: `found ${one.version}`, group: "Detected" })),
    ...all.map((agent) => ({ value: agent.id, label: agent.name, group: "Other available agents" })),
    ...(more ? [{ value: MORE, label: "Show more...", group: "Other available agents" }] : []),
  ];
  let picked = await ui.multiselect({
    message: "Select agents to configure",
    choices: offer(others.slice(0, SHOWN), others.length > SHOWN),
    initial: taken,
  });
  if (picked.includes(MORE)) {
    picked = await ui.multiselect({ message: "Select agents to configure", choices: offer(others, false), initial: picked.filter((id) => id !== MORE) });
  }
  return picked;
}
