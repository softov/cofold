/**
 * The plugins this demo offers, and the agent executables its ACP step looks for.
 *
 * Stand-ins for what a real host reads from plugin manifests (`description`,
 * `categories`) and from its PATH search. Nothing here is ahpd's; it is the
 * shape of the data the flow needs, so the flow can be checked before ahpd's
 * own are wired in.
 */

export interface Plugin {
  id: string;
  package: string;
  title: string;
  hint: string;
  /** A manifest category: `agent`, `interface`, `channel`, `tool`. */
  category: "agent" | "interface" | "channel" | "tool";
  /** Whether a first run starts with it ticked. */
  first?: boolean;
}

export const PLUGINS: readonly Plugin[] = [
  { id: "claude", package: "@demo/agent-claude", title: "Claude Code", hint: "Native SDK", category: "agent", first: true },
  { id: "pi", package: "@demo/agent-pi", title: "Pi", hint: "Native SDK", category: "agent" },
  { id: "cofold", package: "@demo/agent-cofold", title: "Cofold", hint: "Native SDK", category: "agent" },
  { id: "acp", package: "@demo/agent-acp", title: "ACP", hint: "External agents", category: "agent" },
  { id: "web", package: "@demo/web", title: "Web UI", hint: "Browser access", category: "interface", first: true },
  { id: "computer", package: "@demo/computer", title: "Computers", hint: "Isolated environments", category: "tool" },
  { id: "push", package: "@demo/push", title: "Notifications", hint: "Session alerts", category: "channel" },
  { id: "bot", package: "@demo/bot", title: "Bots", hint: "Conversational bots", category: "channel" },
];

/** The heading a manifest category is listed under. */
export const HEADINGS: Readonly<Record<Plugin["category"], string>> = {
  agent: "Agent providers",
  interface: "Interfaces",
  channel: "Extensions",
  tool: "Extensions",
};

export interface Agent {
  id: string;
  name: string;
}

/** The ACP agents the plugin can run, in the order they are offered. */
export const AGENTS: readonly Agent[] = [
  { id: "claude", name: "Claude Code CLI" },
  { id: "codex", name: "Codex" },
  { id: "gemini", name: "Gemini" },
  { id: "copilot", name: "Copilot" },
  { id: "opencode", name: "OpenCode" },
  { id: "goose", name: "Goose" },
  { id: "kimi", name: "Kimi" },
  { id: "qwen", name: "Qwen Code" },
];

/** How many not-found agents the first look shows before "Show more". */
export const SHOWN = 4;
