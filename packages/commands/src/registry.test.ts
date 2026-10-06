import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry.js";
import { output } from "./context.js";
import { ArgumentError } from "./errors.js";

describe("capabilities", () => {
  it("resolves dependencies before the handler and disposes in reverse", async () => {
    const events: string[] = [];
    const registry = createRegistry()
      .provide("config", {
        resolve: () => { events.push("config"); return { url: "https://example.test" }; },
        dispose: () => { events.push("dispose config"); },
      })
      .provide("server", {
        deps: ["config"],
        resolve: ({ config }) => { events.push(`server ${config.url}`); return { get: () => "ok" }; },
        dispose: () => { events.push("dispose server"); },
      });

    const command = registry.command({
      id: "get",
      pattern: ["get"],
      summary: "",
      needs: ["server"],
      run: (context) => { events.push(`run ${context.server.get()}`); return output(null); },
    });
    registry.register(command);

    await registry.execute(command, { surface: "cli", input: {} });
    expect(events).toEqual([
      "config",
      "server https://example.test",
      "run ok",
      "dispose server",
      "dispose config",
    ]);
  });

  it("resolves each capability once however many things need it", async () => {
    let resolved = 0;
    const registry = createRegistry()
      .provide("config", { resolve: () => { resolved += 1; return {}; } })
      .provide("a", { deps: ["config"], resolve: () => "a" })
      .provide("b", { deps: ["config"], resolve: () => "b" });
    const command = registry.command({
      id: "both", pattern: ["both"], summary: "", needs: ["a", "b"],
      run: (context) => output(`${context.a}${context.b}`),
    });
    registry.register(command);
    const result = await registry.execute(command, { surface: "cli", input: {} });
    expect(result?.data).toBe("ab");
    expect(resolved).toBe(1);
  });

  it("disposes what was opened when a later capability throws", async () => {
    const events: string[] = [];
    const registry = createRegistry()
      .provide("first", { resolve: () => "first", dispose: () => { events.push("disposed"); } })
      .provide("second", { deps: ["first"], resolve: () => { throw new ArgumentError("no"); } });
    const command = registry.command({
      id: "x", pattern: ["x"], summary: "", needs: ["second"], run: () => output(null),
    });
    registry.register(command);
    await expect(registry.execute(command, { surface: "cli", input: {} })).rejects.toThrow("no");
    expect(events).toEqual(["disposed"]);
  });

  it("refuses a capability named after something the context already has", () => {
    expect(() => createRegistry().provide("input", { resolve: () => 1 })).toThrow(/already has it/u);
  });

  it("refuses a command that needs something unregistered", () => {
    const registry = createRegistry();
    registry.register({ id: "x", pattern: ["x"], summary: "", needs: ["nowhere"], run: () => {} });
    expect(() => registry.verify()).toThrow(/nowhere/u);
  });

  it("keeps the context's own methods working through the capability proxy", async () => {
    const registry = createRegistry().provide("thing", { resolve: () => 42 });
    const command = registry.command({
      id: "x", pattern: ["x", ":id"], summary: "", needs: ["thing"],
      run: (context) => output({ id: context.value("id"), thing: context.thing }),
    });
    registry.register(command);
    const result = await registry.execute(command, { surface: "cli", input: { id: "7" } });
    expect(result?.data).toEqual({ id: "7", thing: 42 });
  });
});

describe("registration", () => {
  it("refuses a required slot after an optional one", () => {
    const registry = createRegistry();
    expect(() => registry.register({
      id: "x", pattern: ["x", ":a?", ":b"], summary: "", run: () => {},
    })).toThrow(/after an optional/u);
  });

  it("refuses a group that was never declared", () => {
    const registry = createRegistry({ groups: [{ name: "work", title: "Work" }] });
    expect(() => registry.register({
      id: "x", pattern: ["x"], summary: "", group: "other", run: () => {},
    })).toThrow(/not declared/u);
  });

  it("refuses a command with no group when the program renders by group", () => {
    const registry = createRegistry({ groups: [{ name: "work", title: "Work" }] });
    expect(() => registry.register({ id: "x", pattern: ["x"], summary: "", run: () => {} }))
      .toThrow(/no group/u);
  });

  it("keeps the effect and the resource of a command built by hand", () => {
    const registry = createRegistry();
    registry.register({
      id: "pet.remove", pattern: ["pet", "remove", ":id"], summary: "",
      effect: "remove", resource: { kind: "pet", key: "id" }, run: () => {},
    });
    expect(registry.find("pet.remove")).toMatchObject({ effect: "remove", resource: { kind: "pet", key: "id" } });
  });

  it("refuses an effect that is not read, add, change or remove", () => {
    const registry = createRegistry();
    expect(() => registry.register({
      id: "pet.remove", pattern: ["pet", "remove"], summary: "", effect: "delete" as never, run: () => {},
    })).toThrow("pet.remove declares the effect delete, which is not one of read, add, change, remove");
  });

  it("refuses a resource with no kind", () => {
    const registry = createRegistry();
    expect(() => registry.register({
      id: "pet.list", pattern: ["pet", "list"], summary: "", resource: { kind: "" }, run: () => {},
    })).toThrow("pet.list declares a resource with no kind");
  });

  it("refuses a key that is not an input field", () => {
    const registry = createRegistry();
    expect(() => registry.action({
      id: "pet.show", summary: "", effect: "read", resource: { kind: "pet", key: "name" },
      input: { id: { type: "string" } }, required: ["id"],
      surfaces: { cli: { pattern: ["pet", "show", ":id"] } }, run: () => {},
    })).toThrow("pet.show names name as its resource key, which is not an input field");
  });

  it("takes a key over a list field, which a client fills with a list of one", () => {
    const registry = createRegistry();
    expect(() => registry.action({
      id: "plugin.remove", summary: "", effect: "remove", resource: { kind: "plugin", key: "name" },
      input: { name: { type: "array", items: { type: "string" } } }, required: ["name"],
      surfaces: { cli: { pattern: ["plugin", "remove", ":name..."] } }, run: () => {},
    })).not.toThrow();
    expect(() => registry.action({
      id: "tag.drop", summary: "", effect: "remove", resource: { kind: "tag", key: "tag" },
      input: { tag: { type: "array", items: { type: "string" } } },
      surfaces: { cli: { pattern: ["tag", "drop"] } }, run: () => {},
    })).not.toThrow();
  });

  it("refuses no combination for having no role", () => {
    const registry = createRegistry();
    expect(() => registry.action({
      id: "user.add", summary: "", effect: "add", resource: { kind: "user", key: "id" },
      input: { id: { type: "string" } }, required: ["id"],
      surfaces: { cli: { pattern: ["user", "add", ":id"] } }, run: () => {},
    })).not.toThrow();
    expect(() => registry.action({
      id: "daemon.restart", summary: "", effect: "change",
      surfaces: { cli: { pattern: ["restart"] } }, run: () => {},
    })).not.toThrow();
  });

  it("refuses two commands with the same id", () => {
    const registry = createRegistry();
    registry.register({ id: "x", pattern: ["x"], summary: "", run: () => {} });
    expect(() => registry.register({ id: "x", pattern: ["y"], summary: "", run: () => {} }))
      .toThrow(/registered as x/u);
  });
});

describe("request lifecycle", () => {
  it("refuses capability-only scopes without an authorizer", async () => {
    let opened = false;
    const registry = createRegistry().provide("protected", { scopes: ["write"], resolve: () => { opened = true; } });
    const command = registry.action({ id: "x", summary: "", needs: ["protected"], surfaces: { mcp: true }, run: () => output(null) });
    await expect(registry.execute(command, { surface: "mcp", input: {} })).rejects.toThrow(/nothing in this program checks/);
    expect(opened).toBe(false);
  });
  it("attempts every disposer even if one fails", async () => {
    const events: string[] = [];
    const registry = createRegistry()
      .provide("first", { resolve: () => 1, dispose: () => { events.push("first"); } })
      .provide("second", { deps: ["first"], resolve: () => 2, dispose: () => { events.push("second"); throw new Error("failure"); } });
    const command = registry.action({ id: "x", summary: "", needs: ["second"], surfaces: { mcp: true }, run: () => output(null) });
    await expect(registry.execute(command, { surface: "mcp", input: {} })).rejects.toThrow(/disposal/);
    expect(events).toEqual(["second", "first"]);
  });
  it("does not open capabilities for an already aborted invocation", async () => {
    let opened = false;
    const registry = createRegistry().provide("lease", { resolve: () => { opened = true; } });
    const command = registry.action({ id: "x", summary: "", needs: ["lease"], surfaces: { mcp: true }, run: () => output(null) });
    const controller = new AbortController(); controller.abort();
    await expect(registry.execute(command, { surface: "mcp", input: {}, signal: controller.signal })).rejects.toThrow();
    expect(opened).toBe(false);
  });
});
