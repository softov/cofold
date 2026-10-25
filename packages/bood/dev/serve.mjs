/**
 * The playground's server: `npm run dev`.
 *
 * Serves this package's folder as static files (the page in `dev/`, the
 * built package in `dist/`, and the reference drawings in `src/`), keeps
 * `tsc --watch` running, and reloads the page when anything it serves
 * changes. No dependencies beyond Node and the workspace's TypeScript.
 */

import { spawn } from "node:child_process";
import { createReadStream, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5199);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".json": "application/json",
};

/** Pages waiting to be told to reload. */
const listeners = new Set();
let pending;
const reload = () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    for (const res of listeners) res.write("data: reload\n\n");
  }, 150);
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": open\n\n");
    listeners.add(res);
    req.on("close", () => listeners.delete(res));
    return;
  }
  const path =
    url.pathname === "/" ? "/dev/index.html" : decodeURIComponent(url.pathname);
  const file = normalize(join(here, path));
  // Only files under this package are served.
  if (!file.startsWith(resolve(here) + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error("not a file");
  } catch {
    res
      .writeHead(404, { "content-type": "text/plain" })
      .end(`Not found: ${path}`);
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is taken: is the playground already running? Set PORT to use another.`
      : error.message,
  );
  process.exit(1);
});

// The watchers and the compiler start once the port is ours, so a second run leaves nothing behind.
server.listen(port, host, () => {
  console.log(`bood playground: http://${host}:${port}/`);
  for (const folder of ["dist", "dev", "src"]) {
    watch(join(here, folder), { recursive: true }, (_, name) => {
      if (folder === "src" && !String(name).endsWith(".svg")) return;
      reload();
    });
  }
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  const compiler = spawn(
    process.execPath,
    [tsc, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"],
    { cwd: here, stdio: "inherit" },
  );
  const stop = () => {
    compiler.kill();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
