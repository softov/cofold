# Commands

```ts
kernel.command({
  id, pattern, summary, description, group,
  arguments, options, needs, scopes, input, stdin,
  surfaces, examples, hidden, meta,
  run,
})
```

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

`coerce` is a parse *and* a JSON Schema fragment, declared together:

```ts
coerce.text | coerce.integer({min, max}) | coerce.decimal() | coerce.boolean
coerce.oneOf(["open", "done"])   // also the completion candidates and the enum
coerce.timestamp | coerce.json | coerce.pair | coerce.commaSeparated()
```

Declaring both is what lets an MCP tool advertise `{"type": "integer", "minimum": 1}` for the same option the terminal parses. A coercer that was only a function could not be described to an agent.

For what per-option coercion cannot express - "either `--since` or `--until`", "`--limit` only with `--sort`" - `input` takes any [Standard Schema](https://standardschema.dev) over the whole canonical object:

```ts
import { z } from "zod";
input: z.object({ since: z.string().optional(), until: z.string().optional() })
        .refine((value) => !(value.since && value.until), "Give one of --since or --until")
```

zod is not a dependency of this library. Neither is valibot or arktype. Any of them works.

## The canonical input

Slots and options become one object, with camelCase keys, coerced and validated. The same object whichever surface produced it - argv, an MCP tool call, an HTTP request - which is what makes a handler transport-blind.

Precedence is fixed and the same everywhere: **what was typed, then the environment, then the default.**

`stdin: "body"` fills that field from a pipe when nothing was given for it.

## Handlers

```ts
run: (context) => output(data, human?, quiet?)
```

`context.input` is the object. The accessors - `value`, `optional`, `flag`, `list`, `pairs`, `required` - are shorthand over it. `context.command` and `context.commands` are there for the commands whose subject is the surface itself.

Return an `Output` rather than printing. `context.write()` exists for the two commands per program whose output *is* the payload, and opting out of the output contract should feel like opting out.

## Surfaces, and meta

```ts
surfaces: { cli: true, mcp: false, docs: true }
```

`mcp` is off unless a command says otherwise: registering a package of commands must never quietly hand an agent a set of arbitrary mutation tools.

`meta` is for whatever an adapter needs and this library does not understand - the HTTP binding a remote command carries, for instance. Deliberately untyped and deliberately ignored by the core: an extension point the core has an opinion about is not an extension point.
