import { AgentError } from '../errors.js';
import { assertSupportedSchema } from '@facio/commands';
import type { ModelToolDefinition, Tool, ToolDefinition, ToolEffects } from '../types/tool.js';

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function createTool<Input = unknown, Resources = Record<string, unknown>>(
  options: ToolDefinition<Input, Resources>,
): Tool<Input, Resources> {
  if (!NAME_PATTERN.test(options.name)) {
    throw new AgentError({ code: 'invalid_options', message: `tool name "${options.name}" must match ${NAME_PATTERN}` });
  }
  if (!options.description.trim()) {
    throw new AgentError({ code: 'invalid_options', message: `tool "${options.name}" needs a description` });
  }
  if (options.input.type !== 'object') {
    throw new AgentError({ code: 'invalid_options', message: `tool "${options.name}": input schema must have type "object"` });
  }
  assertSupportedSchema({ schema: options.input });
  const effects: ToolEffects = { ...options.effects };
  const definition: ModelToolDefinition = { name: options.name, description: options.description, input: options.input };
  return Object.freeze({
    ...options,
    effects,
    source: 'agent',
    toModelDefinition: () => definition,
  });
}
