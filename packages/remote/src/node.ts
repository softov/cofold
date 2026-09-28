/**
 * A fetch-style handler, served on `node:http`.
 *
 * `serve` answers a `Request` with a `Response`, which is what `Bun.serve` and
 * `Deno.serve` hand over. `node:http` hands over an `IncomingMessage` and a
 * `ServerResponse` instead; `toNodeListener` stands between them. The body
 * arrives as a stream, the response leaves as one with backpressure, and a
 * client that hangs up aborts the request's `signal`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { RequestHandler } from "./serve.js";

/**
 * A `node:http` request listener that answers through `handler`.
 *
 * A request whose URL or `Host` the `Request` constructor refuses is answered
 * 400 here, before the handler is called. A handler that rejects is answered
 * 500 "Failed" when nothing has been sent yet, and ends the connection
 * otherwise.
 */
export function toNodeListener(handler: RequestHandler): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const hungUp = new AbortController();
    response.on("close", () => { if (!response.writableFinished) hungUp.abort(); });

    const incoming = requestOf(request, hungUp.signal);
    if (incoming === null) {
      sendJson(response, 400, { message: "The request URL or Host is not valid" });
      return;
    }
    void handler(incoming)
      .then((answer) => write(answer, response))
      .catch(() => {
        if (!response.headersSent && !response.destroyed) sendJson(response, 500, { message: "Failed" });
        else response.destroy();
      });
  };
}

/** The `Request` one `IncomingMessage` is, or `null` when its URL or `Host` does not parse. */
function requestOf(request: IncomingMessage, signal: AbortSignal): Request | null {
  let url: URL;
  try {
    url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  }
  catch {
    return null;
  }
  const headers = new Headers();
  for (let index = 0; index + 1 < request.rawHeaders.length; index += 2) {
    headers.append(request.rawHeaders[index]!, request.rawHeaders[index + 1]!);
  }
  const method = request.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(request) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
  } as RequestInit);
}

/** Writes `answer` to `response`, streaming its body. */
async function write(answer: Response, response: ServerResponse): Promise<void> {
  response.statusCode = answer.status;
  if (answer.statusText !== "") response.statusMessage = answer.statusText;
  for (const [name, value] of answer.headers) {
    if (name !== "set-cookie") response.setHeader(name, value);
  }
  const cookies = answer.headers.getSetCookie();
  if (cookies.length > 0) response.setHeader("set-cookie", cookies);
  if (answer.body === null) {
    response.end();
    return;
  }
  await pipeline(Readable.fromWeb(answer.body as NodeReadableStream<Uint8Array>), response);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}
