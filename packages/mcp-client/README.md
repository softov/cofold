# @cofold/mcp-client

Use the tools of MCP servers from a `@cofold/agents` agent, over stdio or Streamable HTTP, with no dependency.

```ts
import { createMcpClients, serversOf } from '@cofold/mcp-client';

const clients = createMcpClients({
  servers: serversOf(config.mcpServers, (name, why) => console.warn(`${name}: ${why}`)),
  clientInfo: { name: 'my-app', version: '1.0.0' },
  warn: (message) => console.warn(message),
});
const agent = createAgent({ ..., capabilities: [clients.capability()] });
// ...
await clients.close();
```

## Servers

The shape is Claude Code's `mcpServers`:

```json
{
  "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  "docs": { "type": "http", "url": "https://docs.example.com/mcp", "headers": { "authorization": "Bearer ${DOCS_TOKEN}" } }
}
```

| Key | Meaning |
| --- | --- |
| `command`, `args`, `env`, `cwd` | A stdio server: the process, started once and kept. `env` is set over the process's own. On Windows a bare `npx` is found as `npx.cmd`. |
| `type: "http"`, `url`, `headers` | A Streamable HTTP server; `headers` go with every request. |
| `enabled` | `false` keeps the entry without starting it. |
| `startupTimeoutSec` | How long a server may take to start and list its tools; 10 by default. |
| `toolTimeoutSec` | How long one call may take; 60 by default. |

`${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`; an unset name with no default is said once and kept as written.
An entry with a `url` and no `type` is refused, as in Claude Code.

## Tools

- A tool is named `mcp__<server>__<tool>`. Any character outside `[a-zA-Z0-9_-]` becomes `_`; a name past 64 characters is cut and ends in a short hash.
- The capability marks every tool deferred (`defer: { over: 0 }`), so the model sees one index line per tool until it asks for one.
- A tool's effects come from its hints: `readOnlyHint: true` reads, and reaches the network only with `openWorldHint: true`; any other tool writes, and destroys and reaches the network unless its hints say `false`. The host's permission mode decides on them as on any tool, so every configured server's hints are believed.
- The input schema is reduced to what cofold validates: a `$ref` into `$defs` or `definitions` is inlined, and a keyword cofold does not enforce is dropped. The server still validates its own input.
- The output is the result's text, a resource's text, a link's URI, `[image]` or `[audio]` for media, and `structuredContent` as JSON when there is no text. An `isError` result is a tool error the model sees.

## Connections

- A server starts at the first `tools()` that needs it and stays for the life of the process.
- One that fails is said once, lists no tools, and is tried again at the next `tools()`; one that closes is started again the same way.
- `notifications/tools/list_changed` lists a server's tools again for the next run.
- An aborted call sends `notifications/cancelled`.
- The client answers `ping`, declares no capability, and refuses any other request from the server.
- Over HTTP, the session id and the agreed protocol version go on every request; the GET stream is not opened, and a server that forgets the session closes the connection until the next `tools()`.
- `status()` gives each server's state for a host that shows it; `close()` ends every connection.

OAuth sign-in, the SSE transport, resources and prompts are not supported.
