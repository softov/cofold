# @facio/mcp

**A command registry, read by an agent.**

The same actions as MCP tools: `@facio/mcp` builds the descriptors, `@facio/mcp/stdio` serves them over stdio with no dependencies, and `@facio/mcp/server` mounts Streamable HTTP through the official SDK, declared as an optional peer.

```ts
import { listTools } from "@facio/mcp";
import { serveStdio } from "@facio/mcp/stdio";
```

Depends on [`@facio/commands`](../commands); part of the [facio](https://github.com/softov/facio) family.
The manual page is [`docs/commands/07-mcp.md`](../../docs/commands/07-mcp.md); the whole framework is described in [`@facio/commands`](../commands).

## License

MIT
