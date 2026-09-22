import type { HttpTransportOptions } from "./types/http.js";
import type { HttpBinding, Transport } from "./types/manifest.js";
import { basicAuthorization, type CookieJar } from "./auth.js";
import { compact, UnavailableError, DoopxError } from "@doopx/commands";
import { bodyFields, expandPath, placementOf } from "./manifest.js";

/**
 * The transport a command built from a manifest uses, and where the credentials are.
 *
 * On this side of the boundary on purpose. A manifest says what a command is;
 * it does not get to say where to send it or what to send with it. A server
 * that could name the host and the header would be a server that could point a
 * client's token somewhere else.
 */

export class HttpError extends DoopxError {
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

      const contentType = binding.contentType ?? "application/json";
      const fields = bodyFields(binding, input);
      const form = new URLSearchParams();
      if (contentType === "application/x-www-form-urlencoded") {
        for (const [name, value] of Object.entries(fields)) {
          for (const one of Array.isArray(value) ? value : [value]) form.append(name, typeof one === "object" ? JSON.stringify(one) : String(one));
        }
      }
      const body = binding.method === "GET" || binding.method === "DELETE" ? undefined
        : contentType === "application/x-www-form-urlencoded" ? form.toString() : JSON.stringify(fields);
      const headers = new Headers({ accept: "application/json", ...options.headers });
      if (body !== undefined) headers.set("content-type", contentType);
      if (options.auth?.type === "basic") headers.set("authorization", basicAuthorization(options.auth.username, options.auth.password));
      if (options.auth?.type === "cookie" && !headers.has("cookie")) {
        const cookie = options.auth.jar.header(url); if (cookie) headers.set("cookie", cookie);
      }

      options.onRequest?.({ method: binding.method, url: url.toString() });

      let response: Response;
      try {
        response = await call(url, {
          method: binding.method,
          headers: Object.fromEntries(headers),
          redirect: "error",
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

      if (options.auth?.type === "cookie") options.auth.jar.receive(url, response.headers);
      await options.onResponse?.(response, url);
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
