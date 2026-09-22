import type { JsonSchema } from "@cofold/sdk";
/** Optional tool metadata, independent of SDK types. */
export interface McpBinding {
  name?: string;
  description?: string;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  outputSchema?: JsonSchema & { type: "object" };
}
