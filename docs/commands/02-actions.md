# Actions

An action is one thing a program does, declared once, before any surface has spelled it:

```ts
registry.action({
  id: "pet.add",
  summary: "Add a pet",
  needs: ["pets"],

  input: {
    name: { type: "string", minLength: 1, maxLength: 40, description: "What it answers to" },
    age: { type: "integer", minimum: 0, maximum: 30, cli: { short: "-a", value: "YEARS" } },
    breed: { type: "string", enum: ["beagle", "corgi", "mixed"], default: "mixed" },
  },
  required: ["name"],

  surfaces: {
    cli: { pattern: ["pet", "add", ":name"] },
    http: { method: "POST", path: "/pets" },
    mcp: true,
  },

  run: ({ input, pets }) => output(pets.add(input)),
});
```

`input` is a map of JSON Schema, and it is the only statement of what a value may be. The terminal parses against it, the MCP tool advertises it as its `inputSchema`, and an HTTP request is checked against it before the handler is reached - so `--age 99` and `{"age": 99}` are refused for the same reason, by the same code, and no surface can advertise a rule another does not enforce.

The schemas are also the handler's types. `input.breed` is `"beagle" | "corgi" | "mixed"` and `input.age` is `number | undefined`, without a cast and without a second statement of the type for the compiler to disagree with. A field is required if `required` names it or it carries a `default`.

Presence in `surfaces` is what enables a surface, and each surface holds only what is its own: `cli` the words a person types, `http` the method and path, `mcp` nothing but the fact. An action with no `cli` is not a command anybody can type, and one with no `http` is nobody else's business over the network.

Per-field surface detail follows the same rule. `cli` on a field is spelling and never shape - the flag when it is not the field's own name, a short form, the placeholder in the help line. It is stripped before the schema is served, because `"cli": { "short": "-a" }` in front of a model is noise about a terminal it will never see.

## The raw form

`registry.command` is what an action becomes, and what a command that arrived from a manifest already is:

```ts
registry.command({
  id, pattern, summary, description, group,
  arguments, options, needs, scopes, refine, stdin,
  surfaces, examples, hidden, meta,
  run,
})
```

It states the same things in the terminal's vocabulary - slots and options rather than fields - so a spelling can be given that `action` has no way to derive. Everything below describes this form, which is also what `action` produces.

## Identity

`id` is stable, dotted, and never shown to a person: `case.show`. It names the command in errors, in MCP tool names (`case_show`) and in tests. Renaming the words a person types must not rename the id.

`summary` is one line, no full stop, present tense: *"List notes, newest first"*. It is the only text that appears in every rendering, so it does the most work.

`description` is markdown, and is for the paragraph that does not fit: what the command actually does to the world, what it will refuse, what it costs.

## Pattern

The words, with slots.

| token | meaning | usage line |
|---|---|---|
| `"note"` | a literal word | `note` |
| `":id"` | one required word | `<id>` |
| `":id?"` | one optional word | `[id]` |
| `":ids..."` | one or more words | `<ids...>` |
| `":ids?..."` | zero or more words | `[ids...]` |

A pattern must start with a literal, no required slot may follow an optional one, and a variadic slot must be last. All three are checked at registration - a crash on the first run of the binary, not a surprise on the one command nobody tested.

Matching is scored: a literal beats a slot. `report submit c1 bug` resolves to `report submit <case> <type>` and not to `report <id>`, which is the reading a person meant.

`arguments` carries what the pattern cannot: a description, a coercer, and a completion source, keyed by slot name.

## Options

```ts
{
  name: "--limit",        // long form, always
  short: "-n",            // optional; usually a mistake to invent
  value: "N",             // the placeholder. Its ABSENCE is what makes a flag
  description: "How many",
  coerce: coerce.integer({ min: 1 }),
  default: 20,
  env: "NOTES_LIMIT",
  repeatable: false,      // true collects every occurrence
  required: false,
  negatable: false,       // --color also accepts --no-color
  hidden: false,          // parsed, but absent from help and completion
  complete: () => [...],  // candidates for the shell
  field: "limit",         // canonical key; derived otherwise (--dry-run -> dryRun)
}
```

The parser handles `--limit 5`, `--limit=5`, `-n 5`, `-n5`, clusters (`-an5`), `--` to stop reading options, and negation. A value that begins with a dash is refused *only* when the next word is an option this program knows - so `--pattern -foo` and negative numbers work, and the error for a forgotten value names the escape hatch (`--summary=--draft`).

Two commands may declare the same option name with different shapes. The parser resolves the command first with a permissive pass, then re-parses strictly against that command's own table.

## Values

`coerce` is the raw form's way of writing a field's schema, and it is a parse *and* a JSON Schema fragment declared together:

```ts
coerce.text | coerce.string({minLength, maxLength, pattern})
coerce.integer({min, max}) | coerce.decimal({min, max}) | coerce.boolean
coerce.oneOf(["open", "done"])   // also the completion candidates and the enum
coerce.timestamp | coerce.json | coerce.pair | coerce.commaSeparated()
```

Declaring both is what lets an MCP tool advertise `{"type": "integer", "minimum": 1}` for the same option the terminal parses. A coercer that was only a function could not be described to an agent.

What each keyword means, where it is enforced and how a fault is worded is [Validation](03-validation.md).

## The canonical input

Slots and options become one object, with camelCase keys, coerced and validated. The same object whichever surface produced it - argv, an MCP tool call, an HTTP request - which is what makes a handler transport-blind.

Precedence is fixed and the same everywhere: **what was typed, then the environment, then the default.**

`stdin: "body"` fills that field from a pipe when nothing was given for it.

## Handlers

```ts
run: (context) => output(data, plain?, quiet?)
```

`context.input` is the object. The accessors - `value`, `optional`, `flag`, `list`, `pairs`, `required` - are shorthand over it. `context.command` and `context.commands` are there for the commands whose subject is the surface itself.

Return an `Output` rather than printing. `context.write()` exists for the two commands per program whose output *is* the payload, and opting out of the output contract should feel like opting out.

## Surfaces, and meta

An action says which surfaces render it by naming them, and the raw form says so with flags:

```ts
surfaces: { cli: { pattern }, http: { method, path }, mcp: true }   // action
surfaces: { cli: true, mcp: false, docs: true }                     // command
```

`mcp` is off unless a command says otherwise: registering a package of commands must never quietly hand an agent a set of arbitrary mutation tools.

`meta` is for whatever an adapter needs and the core does not understand. It is ignored by the core and typed by whoever owns the key: `@cofold/remote` widens both `Surfaces` and `CommandMeta` by declaration merging, so `surfaces.http` is checked where it is written while the core still knows no protocol. An adapter that grows a key does the same, in its own file:

```ts
declare module "@cofold/commands" {
  interface Surfaces { grpc?: { service: string; method: string } }
}
```
