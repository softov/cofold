#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { coerce, createRegistry, output } from "@facio/commands";
import { globalOptions, Program, renderTable, runEntry } from "@facio/terminal";
import { agentSkill, reference } from "@facio/docs";
import { listTools } from "@facio/mcp";
import {
  defaultStorePath,
  nextId,
  openStore,
  readNotes,
  type Note,
  type Store,
} from "./store.js";

/**
 * `notes` - the whole library in one small program.
 *
 * Read it as an argument rather than as an example: every command below is
 * three or four lines, and everything that would otherwise be in them - loading
 * the store, honouring `--json`, validating the status, filling `--body` from a
 * pipe, completing an id - is declared instead. The last two commands are the
 * point of the design: the reference and the agent-facing skill are *generated
 * from the same registry*, so this program cannot document a command it does
 * not have.
 */

const VERSION = "0.1.0";

const registry = createRegistry({
  groups: [
    { name: "notes", title: "Notes", agent: true },
    { name: "meta", title: "This program", agent: false },
  ],
})
  .provide("config", {
    description: "Where the notes live",
    resolve: (_deps, context) => ({
      storePath: (context.globals["store"] as string | undefined) ?? defaultStorePath(),
      verbose: context.globals["verbose"] === true,
    }),
  })
  .provide("store", {
    description: "The notes themselves",
    deps: ["config"],
    resolve: ({ config }): Store => openStore(config.storePath),
    // Written once, after the handler, whether it succeeded or threw. No
    // command has to remember to save.
    dispose: (store) => { store.flush(); },
  });

const status = coerce.oneOf(["open", "done"]);

/** Completion reads the store directly: it runs before any command does. */
const noteIds = (): string[] => readNotes(defaultStorePath()).map((note) => note.id);

const list = registry.command({
  id: "note.list",
  group: "notes",
  pattern: ["note", "list"],
  summary: "List notes, newest first",
  needs: ["store"],
  surfaces: { mcp: true },
  options: [
    { name: "--status", short: "-s", value: "STATUS", description: "Only this status", coerce: status },
    { name: "--tag", short: "-t", value: "TAG", description: "Only notes with this tag", repeatable: true },
    { name: "--limit", short: "-n", value: "N", description: "How many", coerce: coerce.integer({ min: 1 }), default: 20 },
  ],
  examples: [{ command: "notes note list --status open -t urgent", description: "Open notes tagged urgent" }],
  run: (context) => {
    const wanted = context.list("tag");
    const found = context.store.all()
      .filter((note) => context.optional("status") === undefined || note.status === context.value("status"))
      .filter((note) => wanted.length === 0 || wanted.every((tag) => note.tags.includes(tag)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, context.value<number>("limit"));

    return output(
      found,
      () => renderTable(["id", "status", "title", "tags"],
        found.map((note) => [note.id, note.status, note.title, note.tags.join(",")])),
      found.map((note) => note.id).join("\n"),
    );
  },
});

const show = registry.command({
  id: "note.show",
  group: "notes",
  pattern: ["note", "show", ":id"],
  summary: "Show one note",
  arguments: { id: { description: "The note's id", complete: noteIds } },
  needs: ["store"],
  surfaces: { mcp: true },
  run: (context) => output(context.store.get(context.value("id"))),
});

const add = registry.command({
  id: "note.add",
  group: "notes",
  pattern: ["note", "add", ":title"],
  summary: "Add a note",
  description: "The body is read from `--body`, or from standard input when something is piped in.",
  arguments: { title: { description: "One line, as it will be listed" } },
  needs: ["store"],
  stdin: "body",
  options: [
    { name: "--body", short: "-b", value: "TEXT", description: "The body; a pipe fills this too" },
    { name: "--tag", short: "-t", value: "TAG", description: "Tag it", repeatable: true },
    { name: "--status", value: "STATUS", description: "Where it starts", coerce: status, default: "open" },
  ],
  examples: [
    { command: `notes note add "Ship facio" -t work`, description: "A note with a tag" },
    { command: `git log -1 --format=%B | notes note add "Release"`, description: "The body from a pipe" },
  ],
  run: (context) => {
    const note: Note = {
      id: nextId(context.store.all()),
      title: context.value("title"),
      body: (context.optional("body") ?? "").trim(),
      status: context.value<Note["status"]>("status"),
      tags: context.list("tag"),
      createdAt: new Date().toISOString(),
    };
    context.store.put(note);
    return output(note, `Added note ${note.id}\n`, note.id);
  },
});

const edit = registry.command({
  id: "note.edit",
  group: "notes",
  pattern: ["note", "edit", ":id"],
  summary: "Change a note's title, body or status",
  arguments: { id: { complete: noteIds } },
  needs: ["store"],
  options: [
    { name: "--title", value: "TEXT", description: "A new title" },
    { name: "--body", value: "TEXT", description: "A new body" },
    { name: "--status", value: "STATUS", description: "A new status", coerce: status },
    { name: "--tag", value: "TAG", description: "Replace the tags", repeatable: true },
  ],
  run: (context) => {
    const note = context.store.get(context.value("id"));
    const updated: Note = {
      ...note,
      title: context.optional("title") ?? note.title,
      body: context.optional("body") ?? note.body,
      status: context.optional<Note["status"]>("status") ?? note.status,
      tags: context.list("tag").length === 0 ? note.tags : context.list("tag"),
    };
    context.store.put(updated);
    return output(updated, `Updated note ${updated.id}\n`, updated.id);
  },
});

const remove = registry.command({
  id: "note.remove",
  group: "notes",
  pattern: ["note", "rm", ":ids..."],
  summary: "Remove one or more notes",
  arguments: { ids: { description: "One or more ids", complete: noteIds } },
  needs: ["store"],
  run: (context) => {
    const removed = context.list("ids").map((id) => context.store.remove(id));
    return output(removed, `Removed ${removed.length} note(s)\n`, removed.map((note) => note.id).join("\n"));
  },
});

const tags = registry.command({
  id: "note.tags",
  group: "notes",
  pattern: ["note", "tags"],
  summary: "Every tag in use, with counts",
  needs: ["store"],
  surfaces: { mcp: true },
  run: (context) => {
    const counts = new Map<string, number>();
    for (const note of context.store.all()) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const rows = [...counts].map(([tag, count]) => ({ tag, count })).sort((left, right) => right.count - left.count);
    return output(rows);
  },
});

const where = registry.command({
  id: "config.show",
  group: "meta",
  pattern: ["config"],
  summary: "Show what this installation resolved",
  needs: ["config"],
  run: (context) => output({
    store: context.config.storePath,
    notes: readNotes(context.config.storePath).length,
  }),
});

const docs = registry.command({
  id: "docs",
  group: "meta",
  pattern: ["docs"],
  summary: "Print the command reference as markdown",
  description: "Generated from the registry, so it is never out of date.",
  run: () => output(reference(registry, {
    name: "notes",
    version: VERSION,
    description: "A small note-taking CLI, built on facio.",
    globals: globalOptions,
  })),
});

const skill = registry.command({
  id: "skill",
  group: "meta",
  pattern: ["skill"],
  summary: "Print the agent-facing skill as markdown",
  description: "The same registry, filtered to what an agent can act on.",
  run: () => output(agentSkill(registry, {
    name: "notes",
    description: "Read and write the notes on this machine.",
  })),
});

const toolList = registry.command({
  id: "mcp.tools",
  group: "meta",
  pattern: ["mcp", "tools"],
  summary: "Print the MCP tools this program would serve",
  description: "Only the commands that opted in with `surfaces: { mcp: true }`.",
  run: () => output(listTools(registry)),
});

registry.register(list, show, add, edit, remove, tags, where, docs, skill, toolList);

export const program = new Program({
  name: "notes",
  version: VERSION,
  description: "A small note-taking CLI: the facio playground.",
  registry,
  globals: [
    { name: "--store", value: "PATH", description: "The notes file", env: "NOTES_STORE" },
  ],
});

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await runEntry(program, process.argv.slice(2));
}
