# @cofold/mcp

**A command registry, read by an agent.**

The same actions as MCP tools: `@cofold/mcp` builds the descriptors, `@cofold/mcp/stdio` serves them over stdio with no dependencies, and `@cofold/mcp/server` mounts Streamable HTTP through the official SDK, declared as an optional peer.

```ts
import { listTools } from "@cofold/mcp";
import { serveStdio } from "@cofold/mcp/stdio";
```

A command's `effect` becomes its tool's hints: `read` is read-only, `remove` is destructive, and `meta.mcp.annotations` overrides them key by key.

Depends on [`@cofold/commands`](../commands); part of the [cofold](https://github.com/softov/cofold) family.
The manual page is [`docs/commands/07-mcp.md`](../../docs/commands/07-mcp.md); the whole framework is described in [`@cofold/commands`](../commands).

## License

MIT
