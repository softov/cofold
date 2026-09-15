import { createRegistry, output } from "facio";
import { listenMcpHttp } from "facio/mcp/server";

const registry = createRegistry();
registry.action({ id: "greet", summary: "Greet someone", surfaces: { mcp: true },
  input: { name: { type: "string", minLength: 1 } }, required: ["name"],
  run: ({ input }) => output({ greeting: `Hello, ${input.name}` }),
});
// Explicitly anonymous, loopback-only demonstration. Applications supply authentication.
const listener = await listenMcpHttp(registry, { name: "facio-example", version: "1.0.0", port: 8794, authenticate: () => ({}) });
process.stderr.write(`MCP endpoint: ${listener.url}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void listener.close(); });
