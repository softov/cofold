/**
 * The resolution order, and the question it exists to answer.
 *
 * Not "what is the value" - any object can hold that - but "which file set it",
 * which is the difference between a support ticket that can be answered and one
 * that ends in somebody reading the source.
 */

import { describe, expect, it } from "vitest";
import { configProvider, environmentNameOf, resolveConfig } from "./index.js";
import type { CommandContext } from "../index.js";
import { resolve } from "node:path";

/** The fixtures are POSIX in the source; the resolver speaks the platform's paths, so the test does too. */
const at = (path: string): string => resolve(path);

const files: Record<string, string> = {
  [at("/home/me/.config/depot/config.json")]: JSON.stringify({
    api: "https://user",
    theme: { mode: "dark", color: "blue" },
    retries: 1,
  }),
  [at("/work/project/.depot.json")]: JSON.stringify({
    api: "https://project",
    theme: { mode: "light" },
  }),
  [at("/work/project/deep/nowhere.json")]: JSON.stringify({}),
  [at("/elsewhere/named.json")]: JSON.stringify({ api: "https://named" }),
  [at("/bad/broken.json")]: "{ not json",
  [at("/bad/list.json")]: "[1, 2]",
};

const read = (path: string): string | undefined => files[path];

const base = {
  name: "depot",
  cwd: at("/work/project/deep"),
  home: at("/home/me"),
  env: {} as Record<string, string | undefined>,
  readFile: read,
};

describe("the layers", () => {
  it("merges leaf by leaf rather than replacing the file", () => {
    const config = resolveConfig(base);
    expect(config.values).toEqual({
      api: "https://project",
      theme: { mode: "light", color: "blue" },
      retries: 1,
    });
  });

  it("finds the project file at or above the working directory", () => {
    expect(resolveConfig(base).layers.map((one) => one.kind)).toEqual(["user", "project"]);
    expect(resolveConfig({ ...base, cwd: at("/somewhere/else") }).layers.map((one) => one.kind))
      .toEqual(["user"]);
  });

  it("puts a program's own defaults underneath everything found", () => {
    const config = resolveConfig({ ...base, base: { api: "https://default", extra: true } });
    expect(config.get("api")).toBe("https://project");
    expect(config.get("extra")).toBe(true);
    expect(config.layers[0]?.kind).toBe("base");
  });

  it("lets the environment beat the files, and an explicit path beat the environment", () => {
    const env = { DEPOT_CONFIG: at("/elsewhere/named.json") };
    expect(resolveConfig({ ...base, env }).get("api")).toBe("https://named");
    expect(resolveConfig({ ...base, env, path: at("/home/me/.config/depot/config.json") }).get("api"))
      .toBe("https://user");
  });

  it("reads a relative explicit path against the working directory", () => {
    expect(resolveConfig({ ...base, cwd: at("/elsewhere"), path: "named.json" }).get("api"))
      .toBe("https://named");
  });

  it("names the environment variable after the program", () => {
    expect(environmentNameOf("depot")).toBe("DEPOT_CONFIG");
    expect(environmentNameOf("my-tool")).toBe("MY_TOOL_CONFIG");
  });
});

describe("saying where a value came from", () => {
  it("names the file that last set a path", () => {
    const config = resolveConfig(base);
    expect(config.sourceOf("api")).toBe(at("/work/project/.depot.json"));
    expect(config.sourceOf("theme.mode")).toBe(at("/work/project/.depot.json"));
    expect(config.sourceOf("theme.color")).toBe(at("/home/me/.config/depot/config.json"));
    expect(config.sourceOf("retries")).toBe(at("/home/me/.config/depot/config.json"));
  });

  it("has nothing to say about a path nobody set", () => {
    expect(resolveConfig(base).sourceOf("nothing.here")).toBeUndefined();
    expect(resolveConfig(base).get("nothing.here")).toBeUndefined();
  });
});

/**
 * Absent and unreadable are different answers.
 *
 * A file that was looked for and is not there is the ordinary case. A file that
 * was *named* and is not there is somebody's mistake, and guessing past it
 * would run the command against the wrong target.
 */
describe("what it refuses", () => {
  it("refuses a named file that is not there", () => {
    expect(() => resolveConfig({ ...base, path: at("/elsewhere/missing.json") }))
      .toThrow("was asked for and is not there");
    expect(() => resolveConfig({ ...base, env: { DEPOT_CONFIG: at("/elsewhere/missing.json") } }))
      .toThrow("was asked for and is not there");
  });

  it("refuses a file it cannot read as data, naming the file", () => {
    expect(() => resolveConfig({ ...base, path: at("/bad/broken.json") })).toThrow(`${at("/bad/broken.json")} is not valid JSON`);
    expect(() => resolveConfig({ ...base, path: at("/bad/list.json") })).toThrow("is not an object");
  });
});

describe("bringing a parser", () => {
  it("takes any syntax, because finding the file is the part this owns", () => {
    const config = resolveConfig({
      ...base,
      extensions: [".conf"],
      readFile: (path) => (path === at("/work/project/.depot.conf") ? "api = https://ini" : undefined),
      parse: (text) => Object.fromEntries([text.split(" = ")]) as Record<string, unknown>,
    });
    expect(config.get("api")).toBe("https://ini");
  });
});

describe("as a capability", () => {
  it("reads the explicit path from the program's globals, not from the input", () => {
    const provider = configProvider({ ...base });
    const context = { globals: { config: at("/elsewhere/named.json") } } as unknown as CommandContext;
    expect(provider.resolve({}, context).get("api")).toBe("https://named");
  });

  it("resolves the found files when no global was given", () => {
    const provider = configProvider({ ...base });
    const context = { globals: {} } as unknown as CommandContext;
    expect(provider.resolve({}, context).get("api")).toBe("https://project");
  });
});
