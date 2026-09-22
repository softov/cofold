# Validation

Where is a name held to forty characters? In one place, and every surface reaches it.

```ts
input: {
  name: { type: "string", minLength: 1, maxLength: 40 },
  age: { type: "integer", minimum: 0, maximum: 30 },
  breed: { type: "string", enum: ["beagle", "corgi", "mixed"], default: "mixed" },
  tags: { type: "array", items: { type: "string", maxLength: 20 }, default: [] },
}
```

| what arrives | what happens |
|---|---|
| `pet add "$(printf 'x%.0s' {1..41})"` | `name must be 1 to 40 characters` |
| `pet add Rex --age 99` | `--age must be an integer between 0 and 30` |
| `POST /pets {"age": 99}` | `400 {"message": "age must be an integer between 0 and 30"}` |
| `pet_add({ breed: "poodle" })` | `isError`, `breed must be one of beagle, corgi, mixed` |

Four roads, one rule, one message. That is the whole claim, and it is worth stating what it costs to break: a bound written in a schema for the agent and again in a hand-written check for the terminal is two bounds, and the day one moves is the day the tool description starts lying.

## How it holds

Values reach `check` whatever they arrived as. This is the part that used to be wrong: coercion ran only on values that arrived as *text*, so `--age -5` was refused at a terminal and `{"age": -5}` created the record, and `enum` was never enforced on an object at all because its own type is `string`. Validation was a property of the wire encoding rather than of the declaration.

So the rule is: the canonical input is built the same way from argv, from an MCP tool call and from an HTTP request, and every field goes through its schema on the way. A bound the schema does not state is a bound nobody checks, and a bound it states is one nobody can route around.

## What a schema may say

The schema type is `JsonSchema` from `@doopx/sdk`, the one definition every facio package shares and the one validator (`validateSchema`) they all call, and it is what `z.toJSONSchema()` writes for the ordinary shapes.

```ts
type            string | number | integer | boolean | null | array | object, or a list of them
nullable        the same as listing null
enum, const     a fixed set, or one fixed value
default         used when nothing was given, on every surface
minimum         maximum        exclusiveMinimum  exclusiveMaximum  multipleOf
minLength       maxLength      pattern           format: "date-time"
items           the schema every element of an array is held to
prefixItems     the schemas of the first elements, a tuple
minItems        maxItems       uniqueItems
properties      required       additionalProperties: false refuses a field nobody declared
anyOf           oneOf          allOf
title           description    examples          $schema
```

Nothing is carried that is not checked. `$ref`, `not` and `patternProperties` are absent on purpose and refused at registration rather than passed along: a keyword an agent is shown and a request is not held to reads as a promise, and is worse than one nobody wrote.

`coerce` builds the same schemas for the raw `registry.command` form, and adds the readings text cannot express on its own - `coerce.pair` for `KEY=VALUE`, `coerce.json`, `coerce.commaSeparated()`. A coercer with its own `parse` describes what *arrives*, so `KEY=VALUE` is a `pattern` a client is shown rather than only a message it is refused with.

## The sentence somebody is shown

Built from the schema, so it cannot describe a rule that is not there:

| schema | sentence |
|---|---|
| `{ type: "integer", minimum: 1 }` | an integer >= 1 |
| `{ type: "integer", minimum: 0, maximum: 30 }` | an integer between 0 and 30 |
| `{ type: "string", minLength: 1, maxLength: 40 }` | 1 to 40 characters |
| `{ type: "string", enum: ["a", "b"] }` | one of a, b |
| `{ type: "string", pattern: "^a" }` | text matching ^a |
| `{ type: "array", items: { type: "integer" } }` | a list of an integer |

`expects` overrides it where a sentence reads better than a schema does: `coerce.pair` says `KEY=VALUE`.

## The name in the message

The same fault is named two ways, because the two callers named the field two ways.

```
petshop: --age must be an integer between 0 and 30      # at a terminal
{"message": "age must be an integer between 0 and 30"}  # over HTTP or to an agent
```

A client that sent `{"age": -5}` has no `--age` to correct, and telling it about one sends it looking for a flag in a JSON body.

## Rules a field cannot state alone

"Either `--since` or `--until`", "`--limit` only with `--sort`". `refine` takes any [Standard Schema](https://standardschema.dev) over the whole canonical object, and runs after coercion, so it sees the same object on every surface:

```ts
import { z } from "zod";

refine: z.object({ since: z.string().optional(), until: z.string().optional() })
         .refine((value) => !(value.since && value.until), "Give one of since or until"),
```

Every issue is reported, not the first: somebody who mistyped two options should be told about two options rather than made to run the command again to discover the second one.

zod is not a dependency of this library. Neither is valibot or arktype. The interface is nine lines and is vendored, so any of them works and none of them is installed.

## What the compiler reads

The schemas are also the handler's types, which is one more surface reading the same declaration:

```ts
run: ({ input }) => {
  input.name;   // string          - named in `required`
  input.breed;  // "beagle" | "corgi" | "mixed"  - carries a default, so it is always there
  input.age;    // number | undefined
  input.tags;   // string[]
}
```

No cast, and no second statement of the type for the compiler to disagree with.

[`examples/petshop`](../../examples/commands/petshop/cli.ts) is these rules on all three surfaces, and [`examples/petshop/action.test.ts`](../../examples/commands/petshop/action.test.ts) is the proof that none of them can be made to disagree.
