import type { GetPromptResult, Prompt, ReadResourceResult, Resource, ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import type { McpRequestContext } from "./server.js";

export interface ResourceDefinition {
  resource: Resource;
  visible?(context: McpRequestContext): boolean | Promise<boolean>;
  read(context: McpRequestContext): ReadResourceResult | Promise<ReadResourceResult>;
}

export interface ResourceTemplateDefinition {
  resource: ResourceTemplate;
  visible?(context: McpRequestContext): boolean | Promise<boolean>;
  read(uri: string, variables: Variables, context: McpRequestContext): ReadResourceResult | Promise<ReadResourceResult>;
}

export interface PromptDefinition {
  prompt: Prompt;
  visible?(context: McpRequestContext): boolean | Promise<boolean>;
  get(args: Readonly<Record<string, string>>, context: McpRequestContext): GetPromptResult | Promise<GetPromptResult>;
}
