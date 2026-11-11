// A server on @cofold/mcp's own serveStdio, so the client is checked against cofold's server.
import { ArgumentError, createRegistry, output } from '@cofold/commands';
import { serveStdio } from '@cofold/mcp/stdio';

const registry = createRegistry();
registry.action({
  id: 'note.echo', summary: 'Say the text back', surfaces: { mcp: true },
  input: { text: { type: 'string', minLength: 1 } }, required: ['text'],
  meta: { mcp: { name: 'echo', annotations: { readOnlyHint: true } } },
  run: ({ input }) => output({ said: input.text }, `said: ${input.text}`),
});
registry.action({
  id: 'note.fail', summary: 'Always refuses', surfaces: { mcp: true },
  meta: { mcp: { name: 'fail' } },
  run: () => { throw new ArgumentError('refused on purpose'); },
});
serveStdio(registry, { name: 'cofold-fixture', version: '1', recoverable: (error) => error instanceof ArgumentError });
