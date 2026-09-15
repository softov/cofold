import { createRegistry, output } from "@facio/commands";
import { serveStdio } from "@facio/mcp/stdio";

/**
 * The smallest thing that is a real MCP server.
 *
 * No SDK and no dependencies: the registry already holds the name, the
 * description and the input schema, and `@facio/mcp/stdio` is the read loop that
 * speaks them. Launch it from any MCP client as a subprocess.
 */
const registry = createRegistry();
registry.action({
  id: "greet",
  summary: "Greet someone",
  surfaces: { mcp: true },
  input: { name: { type: "string", minLength: 1 } },
  required: ["name"],
  meta: {
    mcp: {
      annotations: { readOnlyHint: true },
      outputSchema: { type: "object", properties: { greeting: { type: "string" } }, required: ["greeting"] },
    },
  },
  run: ({ input }) => output({ greeting: `Hello, ${input.name}` }),
});

const server = serveStdio(registry, {
  name: "facio-example",
  version: "1.0.0",
  // Stdout is the protocol's. Everything a person reads goes to stderr.
  onDiagnostic: (error) => process.stderr.write(`${String(error)}\n`),
});
await server.closed;
