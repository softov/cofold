import { createServer, type Server } from "node:http";
import { canonicalFromObject, type Runner } from "facio";
import { manifestFrom, type ProgramManifest } from "facio/remote";

/**
 * The registry, answered over HTTP.
 *
 * Routed from the manifest rather than from a table written here, so a command
 * is reachable exactly when it declared `surfaces.http` - which is also exactly
 * what the manifest publishes and what the refusal in `document.ts` withholds.
 * There is no second list to keep in step.
 */
export function createDocumentServer(
  registry: Runner,
  program: { name: string; version: string; description?: string },
): Server {
  const manifest: ProgramManifest = manifestFrom(registry, program);

  return createServer((request, response) => {
    void (async (): Promise<void> => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const send = (status: number, body: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(`${JSON.stringify(body, null, 2)}\n`);
      };

      if (url.pathname === "/cli-manifest") { send(200, manifest); return; }

      for (const described of manifest.commands) {
        const shape = described.http.path.replaceAll(/\{[^}]+\}/gu, "([^/]+)");
        const found = new RegExp(`^${shape}$`, "u").exec(url.pathname);
        if (found === null || described.http.method !== (request.method ?? "GET")) continue;

        const names = [...described.http.path.matchAll(/\{([^}]+)\}/gu)].map((one) => one[1]!);
        const slots = Object.fromEntries(
          names.map((name, at) => [name, decodeURIComponent(found[at + 1]!)]));
        const command = registry.find(described.id)!;

        try {
          const body = request.method === "GET" || request.method === "DELETE"
            ? {}
            : JSON.parse(await new Promise<string>((done) => {
              let text = "";
              request.on("data", (chunk) => { text += String(chunk); });
              request.on("end", () => { done(text === "" ? "{}" : text); });
            })) as Record<string, unknown>;
          const query = Object.fromEntries(url.searchParams);
          const input = await canonicalFromObject(command, { ...query, ...body, ...slots });
          const result = await registry.execute(command, { surface: "remote", input });
          send(200, result?.data ?? null);
        } catch (error: unknown) {
          const argument = (error as { kind?: string }).kind === "argument";
          send(argument ? 400 : 500, { message: error instanceof Error ? error.message : "Failed" });
        }
        return;
      }

      send(404, { message: `No route for ${request.method} ${url.pathname}` });
    })();
  });
}
