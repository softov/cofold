# @doopx/mcp

**A command registry, read by an agent.**

The same actions as MCP tools: `@doopx/mcp` builds the descriptors, `@doopx/mcp/stdio` serves them over stdio with no dependencies, and `@doopx/mcp/server` mounts Streamable HTTP through the official SDK, declared as an optional peer.

```ts
import { listTools } from "@doopx/mcp";
import { serveStdio } from "@doopx/mcp/stdio";
```

Depends on [`@doopx/commands`](../commands); part of the [doopx](https://github.com/softov/doopx) family.
The manual page is [`docs/commands/07-mcp.md`](../../docs/commands/07-mcp.md); the whole framework is described in [`@doopx/commands`](../commands).

## License

MIT
