import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createRegistry, output } from '@cofold/commands';
import { listenMcpHttp } from '@cofold/mcp/server';
import { connectMcp } from './connect.js';
import { sseData } from './sse.js';

const clientInfo = { name: 'test', version: '1' };

function registry() {
  const commands = createRegistry();
  commands.action({
    id: 'note.echo', summary: 'Say the text back', surfaces: { mcp: true },
    input: { text: { type: 'string', minLength: 1 } }, required: ['text'],
    meta: { mcp: { name: 'echo' } },
    run: ({ input }) => output({ said: input.text }, `said: ${input.text}`),
  });
  return commands;
}

describe('connectMcp over Streamable HTTP', () => {
  for (const jsonResponse of [false, true]) {
    it(`speaks to @cofold/mcp's HTTP server with ${jsonResponse ? 'JSON' : 'SSE'} replies, sending the configured header`, async () => {
      const listener = await listenMcpHttp(registry(), {
        name: 'http-fixture', version: '1', jsonResponse,
        authenticate: (request) => (request.headers['authorization'] === 'Bearer t' ? {} : null),
      });
      try {
        const connection = await connectMcp({ name: 'web', server: { type: 'http', url: listener.url.href, headers: { authorization: 'Bearer t' } }, clientInfo, timeoutMs: 10_000 });
        expect(connection.tools().map((tool) => tool.name)).toEqual(['echo']);
        expect(JSON.stringify(await connection.call('echo', { text: 'over http' }))).toContain('over http');
        await connection.close();
        await expect(connectMcp({ name: 'web', server: { type: 'http', url: listener.url.href }, clientInfo, timeoutMs: 10_000 })).rejects.toThrow(/HTTP 40[13]/);
      } finally {
        await listener.close();
      }
    });
  }

  it('keeps the session id, and closes when the server forgets the session', async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      request.on('end', () => {
        seen.push(request.headers['mcp-session-id'] as string | undefined);
        const message = JSON.parse(body) as { id?: number; method: string };
        if (message.method === 'initialize') {
          response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' });
          response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'x' } } }));
        } else if (message.id === undefined) {
          response.writeHead(202).end();
        } else {
          response.writeHead(404).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(connectMcp({ name: 'gone', server: { type: 'http', url: `http://127.0.0.1:${port}/mcp` }, clientInfo, timeoutMs: 5000 })).rejects.toThrow('ended the session');
      expect(seen).toEqual([undefined, 's1', 's1']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('sseData', () => {
  it('yields each event\'s data, joining lines, across chunk boundaries', async () => {
    const chunks = ['event: message\ndata: {"a"', ':1}\n\n: comment\ndata: one\r\ndata: two\r\n\r\n', 'data: last'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
    });
    const events: string[] = [];
    for await (const data of sseData(body)) events.push(data);
    expect(events).toEqual(['{"a":1}', 'one\ntwo', 'last']);
  });
});
