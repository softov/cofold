import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RpcError, createPeer } from './rpc.js';

function pair() {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: Record<string, unknown>[] = [];
  let pending = '';
  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      lines.push(JSON.parse(pending.slice(0, at)) as Record<string, unknown>);
      pending = pending.slice(at + 1);
    }
  });
  const peer = createPeer({ input, output, warn: () => {} });
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
  return { input, peer, lines, settled };
}

describe('the JSON-RPC peer', () => {
  it('answers requests that arrive two to a chunk, and one split over two chunks', async () => {
    const { input, peer, lines, settled } = pair();
    peer.handle('echo', (params) => params['x']);
    input.write('{"jsonrpc":"2.0","id":1,"method":"echo","params":{"x":1}}\n{"jsonrpc":"2.0","id":2,"method":"echo","params":{"x":2}}\n');
    input.write('{"jsonrpc":"2.0","id":3,"meth');
    input.write('od":"echo","params":{"x":"é"}}\n');
    await settled();
    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 1, result: 1 },
      { jsonrpc: '2.0', id: 2, result: 2 },
      { jsonrpc: '2.0', id: 3, result: 'é' },
    ]);
  });

  it('answers a bad line, an unknown method and a handler failure with their codes', async () => {
    const { input, peer, lines, settled } = pair();
    peer.handle('boom', () => { throw new Error('it broke'); });
    peer.handle('refuse', () => { throw new RpcError(-32002, 'not here'); });
    input.write('not json\n{"jsonrpc":"2.0","id":1,"method":"nope"}\n{"jsonrpc":"2.0","id":2,"method":"boom"}\n{"jsonrpc":"2.0","id":3,"method":"refuse"}\n[1]\n');
    await settled();
    expect(lines).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found: nope' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32603, message: 'it broke' } },
      { jsonrpc: '2.0', id: 3, error: { code: -32002, message: 'not here' } },
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } },
    ]);
  });

  it('takes notifications without answering them', async () => {
    const { input, peer, lines, settled } = pair();
    const seen: unknown[] = [];
    peer.on('tick', (params) => { seen.push(params['n']); });
    input.write('{"jsonrpc":"2.0","method":"tick","params":{"n":7}}\n');
    await settled();
    expect(seen).toEqual([7]);
    expect(lines).toEqual([]);
  });

  it('asks the other side and matches its answer and its error by id', async () => {
    const { input, peer, lines, settled } = pair();
    const first = peer.request('ask', { q: 1 });
    const second = peer.request('ask', { q: 2 });
    await settled();
    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 0, method: 'ask', params: { q: 1 } },
      { jsonrpc: '2.0', id: 1, method: 'ask', params: { q: 2 } },
    ]);
    input.write('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"no"}}\n{"jsonrpc":"2.0","id":0,"result":{"ok":true}}\n');
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).rejects.toMatchObject({ code: -32000, message: 'no' });
  });

  it('fails what it asked when the input ends, and says it closed', async () => {
    const { input, peer } = pair();
    const asked = peer.request('ask', {});
    input.end();
    await expect(asked).rejects.toThrow('the client went away');
    await peer.closed;
  });
});
