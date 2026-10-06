---
title: An action declares what it does to what
domain: commands
status: active
priority: high
created: 2026-10-06
revalidated: 2026-10-06
decisions:
  - decisions/action-effect-and-resource.md
refs:
  - "[code://packages/commands/src/types/command.ts#L48-L102](../../../../packages/commands/src/types/command.ts#L48-L102) - `CommandDefinition`, the derived form every surface reads; `Command` is this type"
  - "[code://packages/commands/src/types/command.ts#L154-L178](../../../../packages/commands/src/types/command.ts#L154-L178) - `ActionDefinition`, the authored form `registry.action` takes"
  - "[code://packages/commands/src/command.ts#L44-L131](../../../../packages/commands/src/command.ts#L44-L131) - `commandFor` copies each declaration field onto the `Command` by name, so a new field is copied there or lost"
  - "[code://packages/commands/src/registry.ts#L320-L361](../../../../packages/commands/src/registry.ts#L320-L361) - `validateCommand`, where every registration check names the command id"
  - "[code://packages/commands/src/input.ts#L41](../../../../packages/commands/src/input.ts#L41) - `fieldsOf`, the canonical field names a `key` is checked against"
  - "[code://packages/commands/src/docs.ts#L71-L97](../../../../packages/commands/src/docs.ts#L71-L97) - `commandSection`, the reference entry; its `Needs:` line is the shape an effect line copies"
  - "[code://packages/remote/src/manifest.ts#L72-L104](../../../../packages/remote/src/manifest.ts#L72-L104) - `manifestFrom`, which copies chosen fields into each `ManifestCommand`"
  - "[code://packages/remote/src/manifest.ts#L143-L186](../../../../packages/remote/src/manifest.ts#L143-L186) - `commandsFrom`, the client half that must carry the fields back onto a `Command`"
  - "[code://packages/remote/src/types/manifest.ts#L38-L47](../../../../packages/remote/src/types/manifest.ts#L38-L47) - `ManifestCommand`"
  - "[code://packages/remote/src/serve.ts#L144-L150](../../../../packages/remote/src/serve.ts#L144-L150) - `routesOf`, built once when `serve` is called, where a binding's path parameters are checked"
  - "[code://packages/remote/src/openapi.ts#L117-L191](../../../../packages/remote/src/openapi.ts#L117-L191) - `manifestFromOpenApi` reads a document into a manifest; nothing in the repository writes one"
  - "[code://packages/remote/src/types/openapi.ts#L19-L26](../../../../packages/remote/src/types/openapi.ts#L19-L26) - `OpenApiOperationHint`, the `x-cli` extension and the `hints` option"
  - "[code://packages/mcp/src/index.ts#L85-L115](../../../../packages/mcp/src/index.ts#L85-L115) - `tools`; line 105 sends `meta.mcp.annotations` as they are"
  - "[code://packages/mcp/src/types/binding.ts](../../../../packages/mcp/src/types/binding.ts) - `McpBinding.annotations`, the five MCP hints"
  - "[code://packages/terminal/src/globals.ts#L12-L19](../../../../packages/terminal/src/globals.ts#L12-L19) - the standard global options, which a program may not redeclare"
  - "[code://packages/terminal/src/program.ts#L144-L170](../../../../packages/terminal/src/program.ts#L144-L170) - the step from a parsed command to `registry.execute`, where the question goes"
  - "[code://packages/terminal/src/types/program.ts](../../../../packages/terminal/src/types/program.ts) - `ProgramOptions`; `Io` writes but never reads"
  - "[code://examples/commands/petshop/cli.ts#L49-L132](../../../../examples/commands/petshop/cli.ts#L49-L132) - `pet.list`, `pet.add`, `pet.show`: the worked case"
  - "[code://ROADMAP.md#L19](../../../../ROADMAP.md#L19) - *Interactive prompts*: a question must never trigger in a script"
  - "[code://docs/commands/09-remote.md#L82](../../../../docs/commands/09-remote.md#L82) - HTTP methods remain request metadata"
  - https://spec.openapis.org/oas/v3.1.0#specification-extensions - an Operation Object may carry any `x-` field
  - https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations - `readOnlyHint` defaults to false, `destructiveHint` to true, and `destructiveHint: false` means only additive updates
  - file:///github/ahpd - the consumer: `/api/cli-manifest` and the ahpd-web resource explorer
---

## Goal

An action says what it does (`read`, `add`, `change` or `remove`) and to which kind of thing, and which input field names one item.
Every surface reads that from the one declaration: the manifest and an OpenAPI import carry it, MCP derives its read-only and destructive hints from it, and the terminal asks before a `remove`.
A client such as ahpd-web can then draw a resource from a manifest without knowing the program: a list, a create, and row actions with the key filled in.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg "readOnlyHint|destructiveHint|annotations" packages docs examples` - annotations exist only as `meta.mcp.annotations`, passed through unchanged at [`code://packages/mcp/src/index.ts#L105`](../../../../packages/mcp/src/index.ts#L105).
- `rg -l "openapi|OpenApi" packages/*/src` - only `packages/remote/src/openapi.ts`, which reads a document; no code writes an OpenAPI document from a registry.
- `rg "isTTY|confirm|--yes" packages/terminal/src` - no question is ever asked; `Io` has `out` and `err` and no input.
- `rg -- "--yes" packages examples` and ahpd's packages - no program declares `--yes` as an option today.
- `rg "effect|resource" ROADMAP.md` - no matching item; *Interactive prompts* is the nearest, and it is about missing options, not this.
- `rg "code://packages/(commands|remote|mcp|terminal)/" .project/` - only commands/03, which touches a different branch of `program.ts`.

### Runtime path

```
registry.action({ effect, resource }) -> commandFor -> Command { effect, resource } -> validateCommand
  -> manifestFrom -> ManifestCommand { effect, resource } -> /cli-manifest -> commandsFrom -> Command
  -> tools() -> annotations { readOnlyHint, destructiveHint } over meta.mcp.annotations
  -> Program.run -> remove on a TTY: question on stderr, answer on stdin; --yes skips it
  -> commandSection -> the reference names the effect and the resource
```

### Gaps

- Nothing on a declaration says whether running it reads, adds, changes or removes, or what it acts on.
- MCP clients see no hints unless each action writes them by hand, and MCP's default is `destructiveHint: true`.
- The terminal runs a removal without asking.
- `Not found: an OpenAPI writer - searched "openapi", "OpenApi", "paths:" in packages/*/src.` The OpenAPI surface is the reader, `manifestFromOpenApi`; a writer is a ROADMAP item.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [121 - An action declares its effect and its resource, and its role follows from them](../../../decisions/action-effect-and-resource.md) | Softov, 2026-10-06, "effect + resource" |

The choices below are scope.

| What | Source | Task |
| --- | --- | --- |
| Two typed fields, `effect` and `resource`, on both definitions in `@cofold/commands`, not in `meta`; the role follows from effect and key (decision 121) | Softov, 2026-10-06, asked "is this the shape: effect plus resource?": "effect + resource"; in his words, "identify the command as additive, something that changes, something destructive and the resource kind" | 01 |
| Both definitions get the fields: `ActionDefinition` is where they are written, and `CommandDefinition` is what every surface reads and what `commandsFrom` builds by hand | (defaulted: a field only on the action would be lost on a command that arrives from a manifest) | 01 |
| An unknown effect, an empty `kind`, or a `key` that is not one of the command's input fields is refused at registration, naming the command id | Softov, 2026-10-06, in the brief for this plan | 01 |
| The reference (`commandSection`) shows the effect and the resource; the agent skill table keeps its two columns | Softov, 2026-10-06, "docs generation shows effect if that fits"; (defaulted: the agent table keeps its two columns) | 02 |
| `@cofold/remote` publishes both fields in its manifest, and `commandsFrom` carries them back onto each `Command`; `MANIFEST_VERSION` stays 1, because the fields are optional and `parseManifest` ignores what it does not know | Softov, 2026-10-06, asked "who reads effect besides the manifest?": all three surfaces | 03 |
| OpenAPI: `effect` and `resource` go inside the existing `x-cli` extension on an operation (OpenAPI allows any `x-` field on an Operation Object), and in the `hints` option, which overrides `x-cli` as it does today; an import never derives an effect from the HTTP method | the same answer; [`code://docs/commands/09-remote.md#L82`](../../../../docs/commands/09-remote.md#L82) (methods are request metadata) | 04 |
| `@cofold/mcp` derives `readOnlyHint` from `read` and `destructiveHint` from `remove`; `meta.mcp.annotations` is spread over the derived ones, key by key, so a key it sets wins | the same answer | 05 |
| `@cofold/terminal` asks before a `remove` on a TTY, and `--yes` skips the question | the same answer | 06 |
| `--yes` is a standard global option, on every program | (defaulted: one flag with one meaning everywhere, like `--json`; no program declares `--yes` today) | 06 |
| The question goes to stderr and the answer is read from stdin; anything but `y` or `yes` declines, prints `<program>: not run` on stderr and exits 1 | (defaulted: stdout stays the output contract) | 06 |
| Off a TTY, a `remove` without `--yes` is refused: exit 2, `<program>: <words> removes <kind> <key value>; pass --yes to run it without a terminal` | Softov, 2026-10-06, asked "off a TTY, is a remove without --yes refused or run?": "Refuse, exit 2" | 06 |
| MCP hints: `read` sends `readOnlyHint: true`; `add` sends `readOnlyHint: false, destructiveHint: false`; `change` sends `readOnlyHint: false` and no `destructiveHint`, so MCP's default applies; `remove` sends `readOnlyHint: false, destructiveHint: true` | Softov, 2026-10-06, asked "which MCP hints do add and change send?": "add false, change default" | 05 |
| This plan covers the OpenAPI import only; writing an OpenAPI document from a registry is a ROADMAP item | Softov, 2026-10-06, asked "is writing an OpenAPI document part of this plan?": "ROADMAP item" | 04 |
| Package versions are chosen at release, not in this plan | Softov, 2026-10-06, asked "which versions do the four packages take?": "Decide at release" | 08 |
| petshop declares `resource: { kind: "pet" }` on `pet.list` and `pet.add`, `{ kind: "pet", key: "id" }` on `pet.show`, and gains `pet.remove` (`DELETE /pets/{id}`) so the example shows all four roles | Softov, 2026-10-06, "the examples (petshop) get one declared resource as a worked case"; (defaulted: `pet.remove` added so a `remove` exists to confirm) | 07 |
| A combination with no role (an effect with no resource, `add` with a key, `change` or `remove` with no key) is a plain action, drawn as a form and a result; nothing is refused for it, and the docs say so | Softov, 2026-10-06, asked "what should a client do with a combination that has no role?": "Plain action, in docs" | 01, 08 |
| A resource key may be a variadic slot or a repeatable option; a client fills it with a one-item list, and a test pins that it registers | Softov, 2026-10-06, asked "a resource key that is a variadic or repeatable field: allowed or refused?": "Allowed, client sends a list of one" | 01, 08 |
| `serve` refuses a binding path `{param}` that is not a required, single-valued input field, when it is called; the core stays ignorant of HTTP | Softov, 2026-10-06, asked "where does the path check go?": "New task in plan 04", then "where does remote refuse it?": "When serve() is built" | 09 |

## Proposed architecture

- **Data flow** - the declaration carries `effect` and `resource`; `commandFor` copies them; `manifestFrom` and `manifestFromOpenApi` write them into `ManifestCommand`; `commandsFrom` reads them back.
- **Event flow** - none new; the terminal's question sits between parsing and `registry.execute`.
- **State flow** - none; the fields are data on the declaration.
- **Layer responsibilities** - remote also: the path parameter check in `routesOf` · commands: the types (`Effect`, `Resource` in `src/types/command.ts`), the `EFFECTS` list and the checks in `validateCommand`, the reference line · remote: manifest and OpenAPI import · mcp: the derived annotations · terminal: `--yes`, the question, and `ProgramOptions.confirm` · petshop: the worked case.
- **Source-of-truth files** - [`code://packages/commands/src/types/command.ts`](../../../../packages/commands/src/types/command.ts), [`code://packages/commands/src/registry.ts`](../../../../packages/commands/src/registry.ts)

```ts
// packages/commands/src/types/command.ts
/** What running a command does to the thing it names. */
export type Effect = "read" | "add" | "change" | "remove";

/** The kind of thing a command acts on, and the input field that names one of them. */
export interface Resource {
  kind: string;
  /** An input field naming one item; the same field in each row a list of this kind returns. */
  key?: string;
}
```

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The declaration says what it does to what](task-01-the-declaration-says-what-it-does-to-what.md) | implemented | - |
| [02 - The reference names the effect and the resource](task-02-the-reference-names-the-effect.md) | implemented | 01 |
| [03 - The manifest carries the effect and the resource](task-03-the-manifest-carries-the-effect.md) | implemented | 01 |
| [04 - An OpenAPI operation declares its effect in x-cli](task-04-an-openapi-operation-declares-its-effect.md) | implemented | 03 |
| [05 - MCP hints follow the effect](task-05-mcp-hints-follow-the-effect.md) | implemented | 01 |
| [06 - The terminal asks before a remove](task-06-the-terminal-asks-before-a-remove.md) | implemented | 01 |
| [07 - petshop declares its pets](task-07-petshop-declares-its-pets.md) | implemented | 03, 05, 06 |
| [08 - The docs and the versions](task-08-the-docs-and-the-versions.md) | implemented | 02, 04, 07, 09 |
| [09 - A path parameter is a required input](task-09-a-path-parameter-is-a-required-input.md) | implemented | - |

## Risks and tradeoffs

- The plan spans four packages and nine tasks, which the do-spec skill would make a parent with child plans; it is one plan because Softov asked for one, and each task stays inside one package.
- `--yes` becomes a standard global, so a program that later declares its own `--yes` is refused at construction; no program does today.
- A script that runs a newly declared `remove` without a terminal is refused until it passes `--yes`; only commands that declare `remove` are affected, and none do today.
- A program that binds a path parameter to an optional or list input stops starting once it takes the new `@cofold/remote`; ahpd's `usage.list` is one, and has to split or move `pool` to the query first.
- `key` is checked against input fields, but "the same field in each row a list returns" is a contract nothing checks, because rows are untyped; the doc comment says so.

## Resume state

- **Done so far:** tasks 01 to 09 implemented on 2026-10-06, awaiting Softov's review; nothing committed.
- **Next action:** Softov reviews; tasks that pass move to `done`, then `implemented.md` and the close. The package versions are chosen at release.
- **Open questions:** none.
- **Watch out for:** `commandFor` copies fields by name, so a field not added there vanishes silently; `exactOptionalPropertyTypes` means `compact` or a conditional spread, never `effect: undefined`; vitest's stdin is not a TTY, so tests inject `confirm` rather than rely on the process.

## Final verification checklist

- [ ] An action with `effect` and `resource` keeps both on its `Command`, in the manifest, and after `commandsFrom`.
- [ ] An unknown effect, an empty kind, and an unknown key are each refused at registration, naming the id.
- [ ] MCP `tools/list` shows the derived hints, and `meta.mcp.annotations` overrides them key by key.
- [ ] `petshop pet remove 1` asks on a terminal, `--yes` skips the question, and off a terminal it is refused with exit 2 unless `--yes` is given.
- [ ] `serve` over a command binding `{pool}` to an optional `:pool?` throws at startup, naming the id.
- [ ] `pnpm check` in cofold is clean.
- [ ] `plans/index.md` updated.
