# MCP

```ts
import { listTools, callTool, tools } from "softcli/mcp";

listTools(registry);              // { tools: [{ name, description, inputSchema }] }
await callTool(registry, "note_list", { limit: 5 });
```

No SDK is imported. `tools()` returns plain descriptors with JSON Schema - what the protocol speaks - and wiring them to a particular SDK is a few lines in the program that ships the server, which keeps that program's choice its own.

## Exposure is opt-in

```ts
surfaces: { mcp: true }
```

Off unless a command says so. Registering a package of commands must never quietly hand an agent a set of arbitrary mutation tools, and the default has to live at the declaration rather than at a call site - or somebody eventually passes the wrong filter.

## Where the schema comes from

The same declaration the CLI parses:

```ts
{ name: "--limit", value: "N", description: "How many",
  coerce: coerce.integer({ min: 1 }), default: 20 }
```

becomes

```json
{ "limit": { "type": "integer", "minimum": 1, "description": "How many", "default": 20 } }
```

This is the reason a coercer is a parse *and* a schema fragment. A tool whose input shape had to be inferred from a parse function could not be described at all, and a tool whose shape was declared separately would drift from the option within a month.

Arguments arrive typed over MCP, so nothing is re-parsed - except a string where a number was declared, which is coerced rather than rejected. An agent that sends `"10"` for a count gets the number the terminal would have produced.

## Errors an agent can act on

`callTool` returns `isError` with the message for an `argument`, `conflict` or `authorization` failure - things the agent can fix. Anything else throws: a transport failure is not the agent's to correct, and dressing it up as a tool result invites a retry loop.
