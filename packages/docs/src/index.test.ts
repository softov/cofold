import { describe, expect, it } from "vitest";
import { coerce, createRegistry, output } from "@facio/commands";
import { agentSkill, reference } from "./index.js";

function build() {
  const registry = createRegistry({
    groups: [
      { name: "work", title: "Work", agent: true },
      { name: "setup", title: "Setup", agent: false },
    ],
  });
  registry.register(
    registry.command({
      id: "note.list",
      group: "work",
      pattern: ["note", "list", ":project?"],
      summary: "List notes",
      description: "Newest first.",
      arguments: { project: { description: "Which project" } },
      options: [{ name: "--limit", short: "-n", value: "N", description: "How many", coerce: coerce.integer({ min: 1 }), default: 20 }],
      examples: [{ command: "notes note list acme -n 5" }],
      run: () => output(null),
    }),
    registry.command({
      id: "token.rotate",
      group: "setup",
      pattern: ["token", "rotate"],
      summary: "Rotate the access token",
      run: () => output(null),
    }),
    registry.command({
      id: "internal",
      group: "setup",
      pattern: ["internal"],
      summary: "Hidden",
      hidden: true,
      run: () => output(null),
    }),
  );
  return registry;
}

describe("the reference", () => {
  it("renders every group, with arguments, options and examples", () => {
    const text = reference(build(), { name: "notes", version: "1.0.0" });
    expect(text).toContain("## Work");
    expect(text).toContain("## Setup");
    expect(text).toContain("`notes note list [project]`");
    expect(text).toContain("Which project");
    expect(text).toContain("default `20`");
    expect(text).toContain("notes note list acme -n 5");
  });

  it("leaves out what is hidden", () => {
    expect(reference(build(), { name: "notes" })).not.toContain("`notes internal`");
  });
});

describe("the agent skill", () => {
  it("lists only the groups an agent can act on", () => {
    const text = agentSkill(build(), { name: "notes" });
    expect(text).toContain("note list");
    expect(text).not.toContain("token rotate");
  });
});
