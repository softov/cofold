import { expect, it } from "vitest";
import { canonicalFromCli, canonicalFromObject } from "@doopx/commands";
import { commandsFrom } from "./manifest.js";
import { manifestFromOpenApi } from "./openapi.js";

it("maps form bodies, required fields, query inputs, and stable path names", () => {
  const manifest = manifestFromOpenApi({ openapi: '3.1.0', paths: { '/clients/list': { post: {
    requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1 }, search: { type: 'string' },
    }, required: ['limit'] } } } },
  } } } });
  expect(manifest.commands[0]?.pattern).toEqual(['clients', 'list']);
  expect(manifest.commands[0]?.http.contentType).toBe('application/x-www-form-urlencoded');
  expect(manifest.commands[0]?.options?.[0]?.required).toBe(true);
});
it("reports unsupported operations instead of silently dropping their bodies", () => {
  const issues: unknown[] = [];
  const manifest = manifestFromOpenApi({ paths: { '/upload': { post: { requestBody: { content: { 'multipart/form-data': {} } } } } } },
    { onUnsupported: (issue) => issues.push(issue) });
  expect(manifest.commands).toHaveLength(0);
  expect(issues).toHaveLength(1);
  expect(() => manifestFromOpenApi({ paths: { '/upload': { post: { requestBody: { content: { 'multipart/form-data': {} } } } } } })).toThrow('multipart');
});


it("preserves input defaults and structured values across CLI and object surfaces", async () => {
  const manifest = manifestFromOpenApi({ paths: { '/settings': { post: { requestBody: { content: {
    'application/json': { schema: { type: 'object', properties: {
      count: { type: 'integer', default: 3 }, enabled: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
    } } },
  } } } } } } as Parameters<typeof manifestFromOpenApi>[0]);
  const command = commandsFrom(manifest)[0]!;
  expect(await canonicalFromObject(command, { tags: ['one', 'two'] })).toEqual({ count: 3, tags: ['one', 'two'] });
  expect(await canonicalFromCli(command, { slots: {}, options: { '--tags': '["one"]', '--enabled': 'false' } }))
    .toEqual({ count: 3, tags: ['one'], enabled: false });
});


it("keeps Portuguese tags out of command words without changing the HTTP request", () => {
  const cases = [
    ['/invoice_ctl/observation/create', 'invoiceCtlObservationCreate', 'Cobranças Observação', ['invoice-ctl', 'observation', 'create']],
    ['/invoice_ctl/bank/list_combo', 'invoiceCtlBankListCombo', 'Formas de Pagamento', ['invoice-ctl', 'bank', 'list-combo']],
    ['/invoice_ctl/invoice/list_info', 'invoiceCtlInvoiceListInfo', 'Cobranças', ['invoice-ctl', 'invoice', 'list-info']],
  ] as const;
  for (const [path, operationId, tag, pattern] of cases) {
    const manifest = manifestFromOpenApi({ paths: { [path]: { post: { operationId, tags: [tag] } } } });
    expect(manifest.commands[0]?.pattern).toEqual(pattern);
    expect(manifest.commands[0]?.group).toBe(tag);
    expect(manifest.commands[0]?.id).toBe(operationId);
    expect(manifest.commands[0]?.http.path).toBe(path);
    const withoutId = manifestFromOpenApi({ paths: { [path]: { post: { tags: ['Different heading'] } } } });
    expect(withoutId.commands[0]?.pattern).toEqual(pattern);
  }
});
it("honours an explicit path hint even when a specification later adds operationId", () => {
  const manifest = manifestFromOpenApi({ paths: { '/clients/list': { post: { operationId: 'listClients' } } } },
    { hints: { 'post.clients.list': { pattern: ['client', 'list'] } } });
  expect(manifest.commands[0]?.pattern).toEqual(['client', 'list']);
});


it("requires explicit names when multiple HTTP methods share a path", () => {
  const document = { paths: { '/clients': { get: { operationId: 'listClients' }, post: { operationId: 'createClient' } } } };
  expect(() => manifestFromOpenApi(document)).toThrow('Ambiguous CLI pattern');
  const issues: unknown[] = [];
  expect(manifestFromOpenApi(document, { onUnsupported: (issue) => issues.push(issue) }).commands).toHaveLength(0);
  expect(issues).toHaveLength(2);
  const manifest = manifestFromOpenApi(document, { hints: {
    listClients: { pattern: ['clients', 'list'] }, createClient: { pattern: ['clients', 'create'] },
  } });
  expect(manifest.commands.map((command) => [command.pattern.join(' '), command.http.method]))
    .toEqual([['clients list', 'GET'], ['clients create', 'POST']]);
});
