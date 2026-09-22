# MCP

Cofold offers three layers, and only the last one costs a dependency.

| Import | Speaks | Dependencies |
| --- | --- | --- |
| `@cofold/mcp` | Tool descriptors and calls, no transport | none |
| `@cofold/mcp/stdio` | A complete stdio MCP server | none |
| `@cofold/mcp/server` | Streamable HTTP, through the official SDK | the MCP SDK, as an optional peer |

Most programs want the middle one. An agent launches a CLI as a subprocess and talks to it over two pipes, and newline-delimited JSON-RPC is not worth a web framework. Reach for the SDK when you need HTTP.

## Tool adapter

```ts
import { listTools, callTool, tools } from "@cofold/mcp";

listTools(registry);
await callTool(registry, "note_list", { limit: 5 });
```

Exposure is opt-in: declare `surfaces: { mcp: true }`. Input goes through the same canonicalization and validation used by other surfaces. Standard Schema refinements still run; they are not automatically translated into published JSON Schema.

The existing `callTool` helper returns data serialized into text. Expected argument, authorization, and conflict errors become `isError`; its `recoverable` option customizes that policy. Unexpected errors throw. The server layer below additionally sanitizes unexpected errors at the protocol boundary.

## Serve over stdio

```ts
import { createRegistry, output } from "@cofold/commands";
import { serveStdio } from "@cofold/mcp/stdio";

const registry = createRegistry();
registry.action({
  id: "greet",
  summary: "Greet someone",
  surfaces: { mcp: true },
  input: { name: { type: "string", minLength: 1 } },
  required: ["name"],
  run: ({ input }) => output({ greeting: `Hello, ${input.name}` }),
});

const server = serveStdio(registry, { name: "my-system", version: "1.0.0" });
await server.closed;
```

That is the whole server. Nothing else is installed, and `serveStdio` returns as soon as it is listening, so `closed` is what a program awaits to stay alive until the client goes away. Call `server.close()` to stop early.

Stdout carries protocol messages and nothing else. Handlers get `silentIo` from the registry, so `context.write` goes nowhere and there is no accidental corruption to debug, but a handler that reaches for `console.log` directly will still break the stream. Send anything a person should read to `onDiagnostic`, which is called with every failure Cofold swallowed.

Cofold installs no signal handlers and never calls `process.exit`. The process is yours.

### What it speaks

`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `notifications/cancelled`, and `notifications/progress` outbound. Protocol versions 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07 are accepted, and `initialize` echoes the version the client asked for when it is one of those. Only `tools` is advertised as a capability.

Everything else is refused by name rather than half-answered. There is no pagination, because a registry is a declared set rather than a query result. There are no resources, prompts, sampling, elicitation or tasks. A `tools/call` carrying a task is rejected before the handler runs.

The subset is fixed deliberately, and it is verified the only way that means anything: [`stdio.test.ts`](../../packages/mcp/src/stdio.test.ts) drives the example server as a subprocess using the official SDK client, so the hand-written protocol is checked against the reference implementation on every run. The SDK is a development dependency of Cofold for that test and for the HTTP server. It is never a runtime dependency of yours unless you import `@cofold/mcp/server`.

### Registering it with a client

Most clients take a command and arguments:

```json
{
  "mcpServers": {
    "my-system": { "command": "node", "args": ["./dist/server.js"] }
  }
}
```

## Install the SDK server

Only for Streamable HTTP:

```sh
npm install cofold @modelcontextprotocol/sdk@^1.30.0 zod
```

The SDK is an optional peer, so it is never installed on your behalf. Every other package, the tool adapter and the stdio server all work without it, which [`package.test.ts`](../../packages/mcp/src/server/package.test.ts) checks by staging `@cofold/mcp` and `@cofold/commands` in an empty directory with nothing else installed and importing the entry points.

The HTTP server does require the SDK and everything the SDK requires, Zod included. That subpath is not dependency-free and the README does not claim it is. Cofold still does not ask you to rewrite action schemas in Zod: it hands the SDK the JSON Schema the registry already produced.

Tested SDK: 1.30.0. Supported range: `^1.30.0`. Node: 22 or newer. See the [official SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).

## Tool names and results

MCP metadata belongs in `meta.mcp`, for actions and raw commands alike:

```ts
registry.action({
  id: "case.show",
  summary: "Read a case",
  surfaces: { mcp: true },
  input: { id: { type: "integer", minimum: 1 } },
  required: ["id"],
  meta: {
    mcp: {
      name: "advisor_case_show",
      description: "Read one case with its history",
      annotations: { readOnlyHint: true },
      outputSchema: {
        type: "object",
        properties: { id: { type: "integer" } },
        required: ["id"],
      },
    },
  },
  run: ({ input }) => output({ id: input.id }),
});
```

Explicit names preserve an existing system's tool identities. Derived names retain the existing normalization and truncation. Invalid names and collisions are rejected before serving. Annotations describe behavior; they do not grant permissions.

Both servers return JSON text by default. Declaring an output schema also produces `structuredContent` beside that text, validated against Cofold's supported schema vocabulary, so a client that only understands text still sees the same value. Output schemas must describe objects, and unsupported schema keywords are refused rather than advertised and ignored.

The SDK server additionally accepts `encodeResult({ tool, context, data })`, which can return a typed `CallToolResult` carrying images, audio, resource links or embedded resources. This keeps SDK content types out of ordinary action handlers and leaves CLI plain and quiet output intact. The stdio server has no equivalent and returns text plus optional structured content.

An action that completed but returned invalid output is reported as completed with an unusable result, and told not to retry automatically. A handler that partially commits and then throws remains the application's responsibility; Cofold cannot infer transaction state.

## Authentication, visibility, and authorization

Authentication belongs to the application. On stdio, `context()` supplies trusted invocation data, usually constant because the process was launched by one client. On HTTP there is an authentication resolver, or context supplied by already authenticated middleware.

Handlers and capability providers can read `context.request.actor`, `context.request.id`, and application-supplied `context.request.metadata`. These fields are separate from tool input. The server sets the request id and cancellation signal itself and does not copy client protocol metadata into trusted metadata. The actor's type is application-owned; narrow it in a capability or your authorization function.

The registry's `authorize` hook runs before any capability resolves. It sees the union of action scopes and all transitive capability scopes. Any required scope without an authorizer is refused. Use trusted request data or a closure for credentials; do not load protected resources just to decide whether the caller may access them.

The SDK server's `visible(command, context, scopes)` filters both listing and invocation, so guessing a hidden tool name does not bypass it. Visibility does not replace registry authorization. The stdio server takes a plain `filter(command)` instead, which narrows what `surfaces.mcp` already allowed and can never widen it.

**Compatibility change:** `authorize.capabilities` is now an empty, deprecated field because authorization precedes resolution. Existing authorizers reading resolved credentials must move that identity into trusted request context or a closure. Capability-only and transitive scopes are now enforced as well.

## Streamable HTTP

```ts
import { listenMcpHttp } from "@cofold/mcp/server";

const listener = await listenMcpHttp(registry, {
  name: "my-system",
  version: "1.0.0",
  port: 7483,
  path: "/mcp",
  authenticate: async (request) => {
    const actor = await verifyBearer(request.headers.authorization);
    return actor ? { actor } : null;
  },
});
// await listener.close();
```

`verifyBearer` is your application's function. No resolver and no trusted middleware context means HTTP 401. The standalone example uses an explicit anonymous resolver only to demonstrate a local server.

The listener defaults to loopback and an automatically selected port. `allowedHosts` accepts exact Host header values; the default permits localhost and loopback addresses at any port. `allowedOrigins` accepts exact browser origins; the default refuses requests carrying an Origin header. Configure these explicitly for a remote deployment. Authentication, TLS termination, CORS/preflight policy, and token issuance remain application concerns.

The handler limits JSON bodies to 1 MiB by default (`maxBodyBytes`). Only POST is supported. There are no persisted sessions, replay storage, resumability, or standalone GET streams. Responses use SSE by default so request-related progress can be delivered. `jsonResponse: true` selects plain JSON and cannot carry progress notifications.

### Mount in an existing server

```ts
import { createMcpHttpHandler } from "@cofold/mcp/server";

const handleMcp = createMcpHttpHandler(registry, {
  name: "my-system",
  version: "1.0.0",
});

// Inside already authenticated Fastify middleware:
app.all("/mcp", async (request, reply) => {
  reply.hijack();
  await handleMcp(request.raw, reply.raw, {
    body: request.body,
    context: { actor: request.actor },
  });
});
```

The middleware must reject unauthenticated callers before constructing this trusted context. Pass an already parsed body when middleware consumed the stream. Cofold checks its serialized size, but middleware must enforce its own input-size limit before parsing. Once handed over, the MCP handler owns the response; do not send a second framework response. Call `handleMcp.close()` during application shutdown.

## Cancellation, progress, and lifecycle

Handlers receive `context.signal`. Check it during long operations and pass it to APIs that support cancellation. Capability resolution checks it before opening each dependency and before entering the handler. Every opened capability is offered disposal in reverse order, even when another disposer fails.

Call `await context.request?.progress?.({ progress: 1, total: 3, message: "Reading" })` to report work. Progress must increase, remain finite, and not exceed a supplied total. Without a caller progress token it produces no protocol notification.

Over stdio, `notifications/cancelled` aborts the signal for exactly that request id and the call is then never answered, which is what the protocol asks for. Stateless HTTP uses a separate server per request, so a later cancellation POST cannot reach work owned by an earlier one. Client disconnect and shutdown abort whatever was still running. Cancellation never promises rollback.

On the SDK server, `onSuccess` runs after handler execution and capability disposal, and `onFailure` observes execution or encoding failures. On both servers, cleanup failures following a successful handler go to `onDiagnostic` and do not erase the returned result. An observer that throws cannot change a completed mutation's result. These hooks are for notification and observation, not for transaction commit.

Expected argument, authorization and conflict errors become readable tool errors on both. Anything else becomes a generic failure with the detail sent to `onDiagnostic`, so a stack or a secret never reaches the client. The SDK server's `mapError` adapts application-specific faults; the stdio server's `recoverable` decides which failures are readable.

`toolListChanged: true` on the SDK server enables explicit `server.sendToolListChanged()` calls. Listing re-reads the registry and its permission policy. The stdio server does not offer this.

## Resources, templates, and prompts

**SDK server only, and provisional.** These have no consumer yet and may change or be removed before release. They are separate definitions supplied to server options, not executable actions:

```ts
const options = {
  name: "notes", version: "1.0.0",
  resources: [{
    resource: { name: "Guide", uri: "notes://guide" },
    read: () => ({ contents: [{ uri: "notes://guide", text: "How to use notes" }] }),
  }],
  resourceTemplates: [{
    resource: { name: "Note", uriTemplate: "notes://item/{id}" },
    read: (uri, variables, context) => readAuthorizedNote(uri, variables.id, context.actor),
  }],
  prompts: [{
    prompt: { name: "review", arguments: [{ name: "subject", required: true }] },
    get: (args) => ({ messages: [{ role: "user", content: { type: "text", text: args.subject } }] }),
  }],
};
```

Each definition can declare `visible(context)`, checked at discovery and access. Read/render handlers must enforce any additional resource-specific policy. Exact resources take precedence over templates; templates are matched in declaration order. Prompt arguments are checked against their declared names and required flags. SDK result schemas validate read/render output. Duplicate resource URIs, template strings, and prompt names are rejected.

The stdio server implements none of this and advertises only `tools`. Resource subscriptions, list-change notifications for resources and prompts, completion, sampling, elicitation, task execution and stateful or resumable HTTP are not implemented by either adapter and are not advertised. A tool call requesting task execution is rejected before its handler runs. Large catalogues return one list without pagination.

## Examples and Advisor migration

After `npm run examples`:

```sh
node examples/dist/mcp-server/stdio.js
node examples/dist/mcp-server/http.js
```

The first is a complete MCP server with no dependencies, meant to be launched by a client as a subprocess. The second listens at `http://127.0.0.1:8794/mcp` and needs the SDK installed.

Advisor can retain its operation services and SDK transport ownership while adopting `createMcpServer`, or mount `createMcpHttpHandler` in Fastify. Preserve existing tool names with `meta.mcp.name`; adapt its actor and scope-rank checks through context/visibility/authorization; map `OperationFault` with `mapError`; send successful-write announcements from `onSuccess`.

Advisor's stdio mode is an HTTP client to its selected target. Its Cofold action handlers must keep that remote invocation path, including acting-user headers; they must not open Advisor's database locally. Keep existing Zod schemas as refinements or inside domain handlers where needed.

Advisor itself has not been migrated. Its catalogue baseline, integration tests and deployment remain work in the Advisor repository.
