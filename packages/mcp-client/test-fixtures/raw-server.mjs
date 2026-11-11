// A hand-written stdio server: two pages of tools, list_changed, cancel, a ping to the client, stderr, and a
// version it may refuse (RAW_VERSION).
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const tools = [
  { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }, annotations: { readOnlyHint: true } },
  { name: 'wait', description: 'Never answers', inputSchema: { type: 'object' } },
  { name: 'grow', description: 'Adds a tool', inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { item: { $ref: '#/$defs/item' } }, $defs: { item: { type: 'string', not: { const: 'x' } } } } },
];
const cancelled = [];
let pong = false;
let pingId;
process.stderr.write('raw server starting\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined && message.method === undefined) { if (message.id === pingId) pong = true; return; }
  switch (message.method) {
    case 'initialize':
      send({ id: message.id, result: { protocolVersion: process.env.RAW_VERSION ?? message.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'raw', version: '1' }, instructions: 'Raw rules.' } });
      break;
    case 'notifications/initialized':
      pingId = 'p1';
      send({ id: pingId, method: 'ping' });
      break;
    case 'tools/list': {
      const page = message.params?.cursor === 'two' ? tools.slice(2) : tools.slice(0, 2);
      send({ id: message.id, result: { tools: page, ...(message.params?.cursor === 'two' ? {} : { nextCursor: 'two' }) } });
      break;
    }
    case 'notifications/cancelled':
      cancelled.push(message.params.requestId);
      break;
    case 'tools/call': {
      const { name, arguments: input } = message.params;
      if (name === 'add') send({ id: message.id, result: { content: [{ type: 'text', text: String(input.a + input.b) }] } });
      else if (name === 'grow') {
        tools.push({ name: 'grown', description: 'Grown', inputSchema: { type: 'object' } });
        send({ id: message.id, result: { content: [{ type: 'text', text: 'grew' }] } });
        send({ method: 'notifications/tools/list_changed' });
      } else if (name === 'state') send({ id: message.id, result: { structuredContent: { cancelled, pong } } });
      else if (name === 'exit') process.exit(3);
      break;
    }
    default:
      if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: 'nope' } });
  }
});
