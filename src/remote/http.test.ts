/**
 * One command, as one request.
 *
 * The manifest says what a command is; this side says where it goes and what it
 * goes with. That split is the point - a server that could name the host and
 * the header would be a server that could point a client's token elsewhere - so
 * what the transport reads from the binding and what it reads from its own
 * options is worth pinning exactly.
 */

import { describe, expect, it } from "vitest";
import { httpTransport, HttpError } from "./http.js";
import type { HttpBinding } from "./manifest.js";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records what it was asked to send, and answers what it was told to. */
function recorder(answer: { status?: number; body?: string } = {}) {
  const seen: Seen[] = [];
  const fetch = (async (url: URL | string, init: RequestInit = {}) => {
    seen.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown,
    });
    const text = answer.body ?? "{}";
    const status = answer.status ?? 200;
    return { ok: status < 400, status, text: async () => Promise.resolve(text) } as Response;
  }) as typeof globalThis.fetch;
  return { seen, fetch, last: () => seen[seen.length - 1]! };
}

const get: HttpBinding = { method: "GET", path: "/pets/{id}" };
const list: HttpBinding = { method: "GET", path: "/pets" };
const add: HttpBinding = { method: "POST", path: "/pets" };

describe("where the input goes", () => {
  it("fills the path with what the path names", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch }).request(get, { id: "42" });
    expect(last().url).toBe("http://service.test/pets/42");
  });

  /*
   * A method with no body puts everything the path did not take in the query,
   * and a method with one puts it in the body. Nothing is restated in the
   * binding to say so, which is why nothing can disagree with it.
   */
  it("puts what is left in the query, for a method that carries no body", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch })
      .request(list, { status: "open", limit: 5 });
    expect(last().url).toBe("http://service.test/pets?status=open&limit=5");
    expect(last().body).toBeUndefined();
  });

  it("puts what is left in the body, for a method that carries one", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch })
      .request(add, { name: "Rex", age: 3 });
    expect(last().body).toEqual({ name: "Rex", age: 3 });
    expect(last().url).toBe("http://service.test/pets");
  });

  it("sends a repeated value once per occurrence", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch })
      .request(list, { tag: ["work", "urgent"] });
    expect(last().url).toBe("http://service.test/pets?tag=work&tag=urgent");
  });

  it("leaves out what nobody gave", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch })
      .request(list, { status: undefined });
    expect(last().url).toBe("http://service.test/pets");
  });

  it("takes the binding's own word over the derivation", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch }).request(
      { method: "POST", path: "/pets", query: ["dryRun"], body: ["name"] },
      { name: "Rex", dryRun: true, ignored: "no" },
    );
    expect(last().url).toBe("http://service.test/pets?dryRun=true");
    expect(last().body).toEqual({ name: "Rex" });
  });
});

describe("what the client brings, and the server never does", () => {
  it("joins the base url without doubling the slash", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test/", fetch }).request(list, {});
    expect(last().url).toBe("http://service.test/pets");
  });

  it("sends the headers it was given, and asks for JSON either way", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch, headers: { authorization: "Bearer t" } })
      .request(add, { name: "Rex" });
    expect(last().headers["authorization"]).toBe("Bearer t");
    expect(last().headers["accept"]).toBe("application/json");
    expect(last().headers["content-type"]).toBe("application/json");
  });

  it("declares no content type when it is sending no content", async () => {
    const { fetch, last } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch }).request(list, {});
    expect(last().headers["content-type"]).toBeUndefined();
  });

  it("says what it is about to do, for whoever asked to watch", async () => {
    const watched: { method: string; url: string }[] = [];
    const { fetch } = recorder();
    await httpTransport({ baseUrl: "http://service.test", fetch, onRequest: (one) => { watched.push(one); } })
      .request(get, { id: "7" });
    expect(watched).toEqual([{ method: "GET", url: "http://service.test/pets/7" }]);
  });
});

describe("what comes back", () => {
  it("reads JSON, and an empty answer as nothing", async () => {
    const found = recorder({ body: '{"id":"1"}' });
    expect(await httpTransport({ baseUrl: "http://x.test", fetch: found.fetch }).request(get, { id: "1" }))
      .toEqual({ id: "1" });

    const empty = recorder({ body: "" });
    expect(await httpTransport({ baseUrl: "http://x.test", fetch: empty.fetch }).request(get, { id: "1" }))
      .toBeNull();
  });

  it("gives back text that is not JSON rather than failing on it", async () => {
    const { fetch } = recorder({ body: "not json" });
    expect(await httpTransport({ baseUrl: "http://x.test", fetch }).request(get, { id: "1" }))
      .toBe("not json");
  });

  /*
   * The server's own sentence when it wrote one. A client that replaced it with
   * "POST /pets answered 400" would be hiding the only useful half.
   */
  it("reports the server's message when there is one", async () => {
    const { fetch } = recorder({ status: 400, body: '{"message":"age must be an integer between 0 and 30"}' });
    await expect(httpTransport({ baseUrl: "http://x.test", fetch }).request(add, { name: "Rex" }))
      .rejects.toThrow("age must be an integer between 0 and 30");
  });

  it("says what it asked and what it got when the server wrote nothing", async () => {
    const { fetch } = recorder({ status: 500, body: "" });
    await expect(httpTransport({ baseUrl: "http://x.test", fetch }).request(add, {}))
      .rejects.toThrow("POST /pets answered 500");
  });

  /*
   * The kind is what decides the exit code and whether a retry could ever help,
   * so a refused token and a fallen-over server must not arrive as one thing.
   */
  it("tells a refusal from an outage from a conflict", async () => {
    const kindOf = async (status: number): Promise<string> => {
      const { fetch } = recorder({ status, body: "" });
      try {
        await httpTransport({ baseUrl: "http://x.test", fetch }).request(add, {});
        return "none";
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HttpError);
        return (error as HttpError).kind;
      }
    };
    expect(await kindOf(401)).toBe("authorization");
    expect(await kindOf(403)).toBe("authorization");
    expect(await kindOf(409)).toBe("conflict");
    expect(await kindOf(503)).toBe("unavailable");
  });

  /*
   * A network that did not answer is not the caller's mistake, and saying so is
   * the difference between "your token is wrong" and "the server is down".
   */
  it("blames the network for a network failure, and keeps the cause", async () => {
    const cause = new Error("connect ECONNREFUSED");
    const fetch = (() => Promise.reject(cause)) as unknown as typeof globalThis.fetch;
    const failed = httpTransport({ baseUrl: "http://service.test", fetch }).request(get, { id: "1" });

    await expect(failed).rejects.toThrow("GET service.test did not answer");
    await expect(failed).rejects.toMatchObject({ kind: "unavailable", cause });
  });
});
