import type { McpRequestContext, McpServerOptions } from "../types/server.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { UriTemplate, type Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import {
  ResourceSchema, ResourceTemplateSchema, PromptSchema,
  ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema, ReadResourceResultSchema, GetPromptResultSchema,
  McpError, ErrorCode, type Resource, type ResourceTemplate, type Prompt,
  type ReadResourceResult, type GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";
import { diagnose, requestContext } from "./server.js";

export function registerResourcesAndPrompts(server: Server, options: McpServerOptions): void {
  const resources = (options.resources ?? []).map((item) => ({ ...item, resource: ResourceSchema.parse(item.resource) }));
  const templates = (options.resourceTemplates ?? []).map((definition) => ({ definition: { ...definition, resource: ResourceTemplateSchema.parse(definition.resource) }, template: new UriTemplate(definition.resource.uriTemplate) }));
  const prompts = (options.prompts ?? []).map((item) => ({ ...item, prompt: PromptSchema.parse(item.prompt) }));
  for (const names of [resources.map((r) => r.resource.uri), templates.map((r) => r.template.toString()), prompts.map((p) => p.prompt.name)]) {
    if (new Set(names).size !== names.length) throw new Error("Duplicate MCP resource or prompt");
  }
  const refused = (): never => { throw new McpError(ErrorCode.InvalidParams, "Unknown or unavailable resource or prompt"); };
  const safely = async <T>(run: () => T | Promise<T>): Promise<T> => {
    try { return await run(); } catch (error: unknown) {
      diagnose(options, error);
      throw new McpError(ErrorCode.InternalError, "Resource or prompt could not be produced");
    }
  };
  const visible = async (item: { visible?: (context: McpRequestContext) => boolean | Promise<boolean> }, context: McpRequestContext): Promise<boolean> =>
    safely(async () => await item.visible?.(context) ?? true);
  if (resources.length + templates.length > 0) {
    server.setRequestHandler(ListResourcesRequestSchema, async (_request, extra) => {
      const context = await requestContext(options, extra);
      const listed: Resource[] = [];
      for (const item of resources) if (await visible(item, context)) listed.push(item.resource);
      return { resources: listed };
    });
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request, extra) => {
      const context = await requestContext(options, extra);
      const listed: ResourceTemplate[] = [];
      for (const { definition } of templates) if (await visible(definition, context)) listed.push(definition.resource);
      return { resourceTemplates: listed };
    });
    server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
      const context = await requestContext(options, extra);
      const item = resources.find((candidate) => candidate.resource.uri === request.params.uri);
      if (item !== undefined) {
        if (!await visible(item, context)) return refused();
        return safely(async () => ReadResourceResultSchema.parse(await item.read(context)));
      }
      for (const { definition, template } of templates) {
        const variables = template.match(request.params.uri);
        if (variables === null) continue;
        if (!await visible(definition, context)) return refused();
        return safely(async () => ReadResourceResultSchema.parse(await definition.read(request.params.uri, variables, context)));
      }
      return refused();
    });
  }
  if (prompts.length > 0) {
    server.setRequestHandler(ListPromptsRequestSchema, async (_request, extra) => {
      const context = await requestContext(options, extra);
      const listed: Prompt[] = [];
      for (const item of prompts) if (await visible(item, context)) listed.push(item.prompt);
      return { prompts: listed };
    });
    server.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
      const context = await requestContext(options, extra);
      const item = prompts.find((candidate) => candidate.prompt.name === request.params.name);
      if (item === undefined || !await visible(item, context)) return refused();
      const args = request.params.arguments ?? {};
      const declared = item.prompt.arguments ?? [];
      if (declared.some((arg) => arg.required && args[arg.name] === undefined)
          || Object.keys(args).some((key) => !declared.some((arg) => arg.name === key))) {
        throw new McpError(ErrorCode.InvalidParams, "Invalid prompt arguments");
      }
      return safely(async () => GetPromptResultSchema.parse(await item.get(args, context)));
    });
  }
}
