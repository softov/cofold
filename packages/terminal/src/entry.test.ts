import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  ArgumentError,
  AuthorizationError,
  createRegistry,
} from "@cofold/commands";
import { Program } from "./program.js";
import { runEntry } from "./entry.js";

function programThatThrows(error: unknown): Program {
  const registry = createRegistry();
  registry.register(registry.command({
    id: "note.show",
    pattern: ["note", "show", ":id"],
    summary: "Show a note",
    run: () => { throw error; },
  }));
  return new Program({
    name: "notes",
    version: "0",
    registry,
    io: { out: () => {}, err: () => {} },
  });
}

/** Everything `runEntry` writes, and nothing else. */
function captureStderr(): string[] {
  const written: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write);
  return written;
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe("runEntry", () => {
  it("writes an expected failure as one JSON line and exits with its code", async () => {
    const written = captureStderr();
    await runEntry(programThatThrows(new ArgumentError("note 7 does not exist")),
      ["note", "show", "7", "--json"]);
    expect(written).toEqual([
      '{"message":"note 7 does not exist","kind":"argument","exitCode":2}\n',
    ]);
    expect(process.exitCode).toBe(2);
  });

  it("carries the missing scopes of an authorization failure", async () => {
    const written = captureStderr();
    await runEntry(programThatThrows(new AuthorizationError("not allowed", ["notes:write"])),
      ["note", "show", "7", "--json"]);
    expect(JSON.parse(written.join(""))).toEqual({
      message: "not allowed",
      kind: "authorization",
      exitCode: 3,
      missing: ["notes:write"],
    });
    expect(process.exitCode).toBe(3);
  });

  it("calls an unexpected error internal and exits 1", async () => {
    const written = captureStderr();
    await runEntry(programThatThrows(new Error("boom")), ["note", "show", "7", "--json"]);
    expect(JSON.parse(written.join(""))).toEqual({
      message: "boom",
      kind: "internal",
      exitCode: 1,
    });
    expect(process.exitCode).toBe(1);
  });

  it("redacts a secret before the message reaches the JSON", async () => {
    const written = captureStderr();
    await runEntry(programThatThrows(new Error("token abcdefgh12345 leaked")),
      ["note", "show", "7", "--json"],
      { secrets: () => ["abcdefgh12345"] });
    expect(JSON.parse(written.join("")).message).toBe("token [redacted] leaked");
  });

  it("keeps the line of today without --json", async () => {
    const written = captureStderr();
    await runEntry(programThatThrows(new ArgumentError("note 7 does not exist")),
      ["note", "show", "7"]);
    expect(written).toEqual(["notes: note 7 does not exist\n"]);
    expect(process.exitCode).toBe(2);
  });

  it("reads a literal --json when the run failed before it chose a mode", async () => {
    const written = captureStderr();
    await runEntry(programThatThrows(new Error("boom")), ["--json", "--nope"]);
    const failure = JSON.parse(written.join("")) as { message: string; kind: string; exitCode: number };
    expect(failure).toMatchObject({ kind: "argument", exitCode: 2 });
    expect(failure.message).toMatch(/^Unknown option --nope\./u);
  });

  it("does not read --json after --", async () => {
    const written = captureStderr();
    await runEntry(programThatThrows(new Error("boom")), ["--nope", "--", "--json"]);
    expect(written.join("")).toMatch(/^notes: Unknown option --nope\./u);
  });

  it("keeps a stack under COFOLD_TRACE as plain text after the JSON line", async () => {
    vi.stubEnv("COFOLD_TRACE", "1");
    const written = captureStderr();
    await runEntry(programThatThrows(new Error("boom")), ["note", "show", "7", "--json"]);
    expect(JSON.parse(written[0] ?? "")).toEqual({ message: "boom", kind: "internal", exitCode: 1 });
    expect(written[1]).toContain("Error: boom");
  });
});
