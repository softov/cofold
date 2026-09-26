import { createServer } from "node:http";
import { serve } from "@cofold/remote";
import { registry } from "./registry.js";

/**
 * The server half of the round trip.
 *
 * `serve` from `@cofold/remote` answers the routes `meta.http` names and the
 * manifest beside them. This file names the registry and the program.
 */

export function createPetServer(program: { name: string; version: string; description?: string }) {
  return createServer(serve(registry, program));
}
