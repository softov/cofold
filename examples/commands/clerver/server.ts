import { createServer } from "node:http";
import { serve, toNodeListener } from "@cofold/remote";
import { registry } from "./registry.js";

/**
 * The server half of the round trip.
 *
 * `serve` from `@cofold/remote` answers the routes `meta.http` names and the
 * manifest beside them, and `toNodeListener` serves it on `node:http`. This
 * file names the registry and the program.
 */

export function createPetServer(program: { name: string; version: string; description?: string }) {
  return createServer(toNodeListener(serve(registry, program)));
}
