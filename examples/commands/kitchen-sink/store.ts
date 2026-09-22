import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigurationError } from "@doopx/commands";

/** A toy store, so the example is about the framework and not about a database. */

export interface Note {
  id: string;
  title: string;
  body: string;
  status: "open" | "done";
  tags: string[];
  createdAt: string;
}

export interface Store {
  path: string;
  all(): Note[];
  get(id: string): Note;
  put(note: Note): void;
  remove(id: string): Note;
  flush(): void;
}

export function defaultStorePath(): string {
  return process.env["NOTES_STORE"] ?? join(homedir(), ".doopx", "notes.json");
}

export function readNotes(path: string): Note[] {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Note[];
  } catch {
    return [];
  }
}

export function openStore(path: string): Store {
  const notes = readNotes(path);
  let dirty = false;

  return {
    path,
    all: () => [...notes],
    get(id) {
      const found = notes.find((note) => note.id === id);
      if (found === undefined) throw new ConfigurationError(`There is no note ${id}`);
      return found;
    },
    put(note) {
      const at = notes.findIndex((one) => one.id === note.id);
      if (at === -1) notes.push(note);
      else notes[at] = note;
      dirty = true;
    },
    remove(id) {
      const at = notes.findIndex((one) => one.id === id);
      if (at === -1) throw new ConfigurationError(`There is no note ${id}`);
      const [removed] = notes.splice(at, 1);
      dirty = true;
      return removed!;
    },
    flush() {
      if (!dirty) return;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(notes, null, 2)}\n`);
      dirty = false;
    },
  };
}

export function nextId(notes: readonly Note[]): string {
  const highest = notes
    .map((note) => Number.parseInt(note.id, 10))
    .filter((value) => Number.isSafeInteger(value))
    .reduce((left, right) => Math.max(left, right), 0);
  return String(highest + 1);
}
