import { compact, UnavailableError, FacioError } from "../index.js";
import { bodyFields, expandPath, placementOf, type HttpBinding, type Transport } from "./manifest.js";

/**
 * The transport a command built from a manifest uses, and where the credentials are.
 *
 * On this side of the boundary on purpose. A manifest says what a command is;
 * it does not get to say where to send it or what to send with it. A server
 * that could name the host and the header would be a server that could point a
 * client's token somewhere else.
 */

export interface HttpTransportOptions {
  baseUrl: string;
  headers?: Readonly<Record<string, string>>;
  /** Injectable, so a test never opens a socket. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  onRequest?(request: { method: string; url: string }): void;
}

export class HttpError extends FacioError {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(status === 401 || status === 403 ? "authorization" : status >= 500 ? "unavailable" : "conflict", message);
    this.status = status;
  }
}

export function httpTransport(options: HttpTransportOptions): Transport {
  const call = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/u, "");

  return {
    async request(binding: HttpBinding, input: Readonly<Record<string, unknown>>): Promise<unknown> {
      const url = new URL(`${base}${expandPath(binding, input)}`);
      for (const name of placementOf(binding, Object.keys(input)).query) {
        const value = input[name];
        if (value === undefined) continue;
        for (const one of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(one));
      }

      const body = binding.method === "GET" || binding.method === "DELETE"
        ? undefined
        : JSON.stringify(bodyFields(binding, input));

      options.onRequest?.({ method: binding.method, url: url.toString() });

      let response: Response;
      try {
        response = await call(url, {
          method: binding.method,
          headers: {
            accept: "application/json",
            ...compact({ "content-type": body === undefined ? undefined : "application/json" }),
            ...options.headers,
          },
          ...compact({
            body,
            // An explicit signal wins: a caller that brought its own cancellation
            // did not ask for a second deadline underneath it.
            signal: options.signal
              ?? (options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs)),
          }),
        });
      } catch (error: unknown) {
        // A transport failure is not the caller's mistake, and saying so is the
        // difference between "your token is wrong" and "the server is down".
        throw new UnavailableError(`${binding.method} ${url.host} did not answer`, { cause: error });
      }

      const text = await response.text();
      const parsed = text === "" ? null : safeJson(text);
      if (!response.ok) {
        const message = typeof parsed === "object" && parsed !== null && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : `${binding.method} ${url.pathname} answered ${response.status}`;
        throw new HttpError(response.status, message);
      }
      return parsed;
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
